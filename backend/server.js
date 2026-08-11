require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let history = [];
let currentTemp = null;
let currentHum = null;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ===================================================
// INICIALIZACIÓN: CARGAR HISTORIAL DESDE SUPABASE
// ===================================================
async function initHistoryFromDB() {
  try {
    const { data, error } = await supabase
      .from('telemetria')
      .select('tipo, valor, created_at')
      .in('tipo', ['temperatura', 'humedad'])
      .order('created_at', { ascending: false })
      .limit(60);

    if (error) throw error;

    if (data && data.length > 0) {
      const records = data.reverse();
      const grouped = {};

      records.forEach(row => {
        // Agrupar lecturas en bloques de 5 segundos
        const timeKey = Math.floor(new Date(row.created_at).getTime() / 5000) * 5000;
        if (!grouped[timeKey]) {
          grouped[timeKey] = {
            at: new Date(timeKey).toISOString(),
            temperature: null,
            humidity: null
          };
        }
        if (row.tipo === 'temperatura') grouped[timeKey].temperature = row.valor;
        if (row.tipo === 'humedad') grouped[timeKey].humidity = row.valor;
      });

      history = Object.values(grouped).slice(-30);
      console.log(`📦 [DATABASE] Historial inicial cargado: ${history.length} registros.`);
    }
  } catch (err) {
    console.error('⚠️ [SUPABASE INIT ERROR]:', err.message);
  }
}
initHistoryFromDB();

function emitChartUpdate() {
  io.emit('mqtt_data', {
    topic: 'CHART_UPDATE',
    payload: {
      temperature: currentTemp,
      humidity: currentHum,
      history: history.slice(-30)
    }
  });
}

function updateChartHistory() {
  const latest = history[history.length - 1];
  const NOW_WINDOW_MS = 5000; // Ventana de 5 segundos

  if (latest && (Date.now() - new Date(latest.at).getTime() < NOW_WINDOW_MS)) {
    if (currentTemp !== null) latest.temperature = currentTemp;
    if (currentHum !== null) latest.humidity = currentHum;
  } else {
    history.push({
      at: new Date().toISOString(),
      temperature: currentTemp,
      humidity: currentHum
    });

    if (history.length > 60) {
      history = history.slice(-60);
    }
  }

  emitChartUpdate();
}

// ===================================================
// MQTT CLIENT (HIVEMQ)
// ===================================================
const mqttClient = mqtt.connect(`mqtts://${process.env.MQTT_HOST}:${process.env.MQTT_PORT}`, {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
  rejectUnauthorized: false
});

mqttClient.on('connect', () => {
  console.log('✅ [MQTT] Conectado a HiveMQ Cloud');
  mqttClient.subscribe('CASA/#', (err) => {
    if (!err) console.log('📡 [MQTT] Suscrito exitosamente a CASA/#');
  });
});

mqttClient.on('error', (err) => {
  console.error('❌ [MQTT ERROR]:', err.message);
});

mqttClient.on('message', async (topic, message) => {
  const payload = message.toString();
  console.log(`📩 [MQTT RECIBIDO] Tópico: ${topic} | Payload: ${payload}`);

  io.emit('mqtt_data', { topic, payload });

  try {
    if (topic === 'CASA/FLAMA') {
      await supabase.from('alertas').insert([{ tipo_alerta: 'FLAMA', descripcion: 'Fuego / Llama detectada' }]);
    } 
    else if (topic === 'CASA/TERREMOTO') {
      await supabase.from('alertas').insert([{ tipo_alerta: 'TERREMOTO', descripcion: 'Sismo / Vibración detectada' }]);
    } 
    else if (topic === 'CASA/PROX') {
      await supabase.from('alertas').insert([{ tipo_alerta: 'PROX', descripcion: 'Puerta abierta' }]);
    } 
    else if (topic === 'CASA/SONIDO') {
      await supabase.from('alertas').insert([{ tipo_alerta: 'SONIDO', descripcion: 'Ruido fuerte detectado' }]);
    }
    // FILTRADO Y VALIDACIÓN DE RANGOS DE TELEMETRÍA
    else if (topic === 'CASA/TEM') {
      const val = parseFloat(payload);
      if (!isNaN(val) && val >= -10 && val <= 70) {
        currentTemp = val;
        await supabase.from('telemetria').insert([{ tipo: 'temperatura', valor: currentTemp }]);
        updateChartHistory();
      } else {
        console.warn(`⚠️ [TEMPERATURA DESCARTADA] Valor fuera de rango: ${val}`);
      }
    } 
    else if (topic === 'CASA/HUM') {
      const val = parseFloat(payload);
      if (!isNaN(val) && val >= 0 && val <= 100) {
        currentHum = val;
        await supabase.from('telemetria').insert([{ tipo: 'humedad', valor: currentHum }]);
        updateChartHistory();
      } else {
        console.warn(`⚠️ [HUMEDAD DESCARTADA] Valor fuera de rango: ${val}`);
      }
    } 
    else if (topic === 'CASA/ESTADO_LUZ') {
      const valLuz = parseInt(payload);
      if (!isNaN(valLuz)) {
        await supabase.from('telemetria').insert([{ tipo: 'luz', valor: valLuz }]);
        await supabase.from('estado_sistema').update({ nivel_luz: valLuz, updated_at: new Date() }).eq('id', 1);
      }
    }
  } catch (error) {
    console.error('❌ [SUPABASE ERROR]:', error.message);
  }
});

io.on('connection', (socket) => {
  console.log(`🔌 [SOCKET.IO] Cliente conectado ID: ${socket.id}`);

  // Enviar historial inicial al conectar un nuevo cliente
  socket.emit('mqtt_data', {
    topic: 'CHART_UPDATE',
    payload: {
      temperature: currentTemp,
      humidity: currentHum,
      history: history.slice(-30)
    }
  });

  socket.on('set_luz', (nuevoBrillo) => {
    console.log(`💡 [SOCKET.IO -> MQTT] Ajustando luz a: ${nuevoBrillo}`);
    mqttClient.publish('CASA/LUZ', nuevoBrillo.toString());
  });

  socket.on('disconnect', () => {
    console.log(`❌ [SOCKET.IO] Cliente desconectado ID: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 [BACKEND] Servidor ejecutándose en el puerto ${PORT}`);
});