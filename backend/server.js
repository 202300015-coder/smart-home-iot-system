require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

// Endpoint de salud para que Render verifique que el servicio está vivo
app.get('/', (req, res) => {
  res.send('Backend IoT Smart Home está activo y funcionando.');
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let history = [];
let currentTemp = null;
let currentHum = null;

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

  if (latest && (Date.now() - new Date(latest.at).getTime() < 4000)) {
    latest.temperature = currentTemp;
    latest.humidity = currentHum;
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
// 1. CONEXIÓN A SUPABASE
// ===================================================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ===================================================
// 2. CONEXIÓN A HIVEMQ CLOUD (MQTT)
// ===================================================
const mqttClient = mqtt.connect(`mqtts://${process.env.MQTT_HOST}:${process.env.MQTT_PORT}`, {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
  rejectUnauthorized: false
});

mqttClient.on('connect', () => {
  console.log('✅ [MQTT] Conectado a HiveMQ Cloud');
  
  mqttClient.subscribe('CASA/#', (err) => {
    if (!err) {
      console.log('📡 [MQTT] Suscrito exitosamente a CASA/#');
    }
  });
});

mqttClient.on('error', (err) => {
  console.error('❌ [MQTT ERROR]:', err.message);
});

// ===================================================
// 3. PROCESAMIENTO Y PERSISTENCIA EN TIEMPO REAL
// ===================================================
mqttClient.on('message', async (topic, message) => {
  const payload = message.toString();
  console.log(`📩 [MQTT RECIBIDO] Tópico: ${topic} | Payload: ${payload}`);

  // Emitir por WebSockets a todos los clientes conectador
  io.emit('mqtt_data', { topic, payload });

  try {
    // A. PROCESAR ALERTAS
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
    // B. PROCESAR TELEMETRÍA
    else if (topic === 'CASA/TEM') {
      currentTemp = parseFloat(payload);
      await supabase.from('telemetria').insert([{ tipo: 'temperatura', valor: currentTemp }]);
      updateChartHistory();
    } 
    else if (topic === 'CASA/HUM') {
      currentHum = parseFloat(payload);
      await supabase.from('telemetria').insert([{ tipo: 'humedad', valor: currentHum }]);
      updateChartHistory();
    } 
    else if (topic === 'CASA/ESTADO_LUZ') {
      const valLuz = parseInt(payload);
      await supabase.from('telemetria').insert([{ tipo: 'luz', valor: valLuz }]);
      await supabase.from('estado_sistema').update({ nivel_luz: valLuz, updated_at: new Date() }).eq('id', 1);
    }
  } catch (error) {
    console.error('❌ [SUPABASE ERROR]:', error.message);
  }
});

// ===================================================
// 4. CANAL BIDIRECCIONAL WEBSOCKETS (FRONTEND -> BACKEND -> MQTT)
// ===================================================
io.on('connection', (socket) => {
  console.log(`🔌 [SOCKET.IO] Cliente conectado ID: ${socket.id}`);

  socket.on('set_luz', (nuevoBrillo) => {
    console.log(`💡 [SOCKET.IO -> MQTT] Ajustando luz a: ${nuevoBrillo}`);
    mqttClient.publish('CASA/LUZ', nuevoBrillo.toString());
  });

  socket.on('disconnect', () => {
    console.log(`❌ [SOCKET.IO] Cliente desconectado ID: ${socket.id}`);
  });
});

// ===================================================
// 5. INICIAR SERVIDOR EN PUERTO DINÁMICO (RENDER)
// ===================================================
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 [BACKEND] Servidor ejecutándose exitosamente en el puerto ${PORT}`);
});