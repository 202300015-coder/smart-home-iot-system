// Conexión directa a tu servidor desplegado en Render
const BACKEND_URL = 'https://smart-home-iot-system.onrender.com';
const socket = io(BACKEND_URL);

// Elementos del DOM
const statusElement = document.getElementById('status');
const tempElement = document.getElementById('temp');
const humElement = document.getElementById('hum');
const luzValueElement = document.getElementById('luz-val');
const sliderLuz = document.getElementById('slider-luz');
const alertsList = document.getElementById('alerts-list');
const chartPlaceholder = document.getElementById('chart-placeholder');
const temperatureLine = document.getElementById('temperatureLine');
const humidityLine = document.getElementById('humidityLine');
const tempMaxValue = document.getElementById('tempMaxValue');
const tempMidValue = document.getElementById('tempMidValue');
const tempMinValue = document.getElementById('tempMinValue');
const humMaxValue = document.getElementById('humMaxValue');
const humMidValue = document.getElementById('humMidValue');
const humMinValue = document.getElementById('humMinValue');

function scaleFor(values) {
  const valid = values.filter(v => Number.isFinite(v));
  if (!valid.length) return null;
  let min = Math.min(...valid);
  let max = Math.max(...valid);
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.04, 1);
    min -= padding;
    max += padding;
  }
  return { min, max, range: max - min };
}

function lineFor(values, scale) {
  if (!scale || values.length < 2) return '';
  return values.map((val, idx) => {
    const x = (idx / (values.length - 1)) * 700;
    const y = 185 - ((val - scale.min) / scale.range) * 145;
    return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
}

function setMetricValue(element, value) {
  if (!element) return;
  element.textContent = Number.isFinite(value) ? value.toFixed(1) : '--';
}

function updateScaleLabels(prefix, scale) {
  const maxElement = document.getElementById(`${prefix}MaxValue`);
  const midElement = document.getElementById(`${prefix}MidValue`);
  const minElement = document.getElementById(`${prefix}MinValue`);

  if (!scale) {
    setMetricValue(maxElement, NaN);
    setMetricValue(midElement, NaN);
    setMetricValue(minElement, NaN);
    return;
  }

  setMetricValue(maxElement, scale.max);
  setMetricValue(midElement, (scale.max + scale.min) / 2);
  setMetricValue(minElement, scale.min);
}

function renderChartState(history = []) {
  const readings = history.filter(entry =>
    Number.isFinite(entry.temperature) && Number.isFinite(entry.humidity)
  );

  const temperatures = readings.map(r => r.temperature);
  const humidity = readings.map(r => r.humidity);

  const tempScale = scaleFor(temperatures);
  const humScale = scaleFor(humidity);

  if (readings.length < 2) {
    if (chartPlaceholder) {
      chartPlaceholder.style.display = '';
    }
    if (temperatureLine) {
      temperatureLine.setAttribute('d', '');
    }
    if (humidityLine) {
      humidityLine.setAttribute('d', '');
    }
    updateScaleLabels('temp', null);
    updateScaleLabels('hum', null);
    return;
  }

  if (chartPlaceholder) {
    chartPlaceholder.style.display = 'none';
  }

  if (temperatureLine) {
    temperatureLine.setAttribute('d', lineFor(temperatures, tempScale));
  }

  if (humidityLine) {
    humidityLine.setAttribute('d', lineFor(humidity, humScale));
  }

  updateScaleLabels('temp', tempScale);
  updateScaleLabels('hum', humScale);
}

function formatReading(value, suffix) {
  return Number.isFinite(value) ? `${value.toFixed(1)} ${suffix}` : '--';
}

// Estado de conexión WebSocket
socket.on('connect', () => {
  console.log('✅ Conectado al backend en Render');
  statusElement.textContent = 'Conectado';
  statusElement.className = 'badge bg-success';
});

socket.on('disconnect', () => {
  console.warn('❌ Desconectado del backend');
  statusElement.textContent = 'Desconectado';
  statusElement.className = 'badge bg-danger';
});

// Recibir datos MQTT transmitidos por Socket.io
socket.on('mqtt_data', (data) => {
  const { topic, payload } = data;
  console.log(`Data recibida [${topic}]:`, payload);

  if (topic === 'CHART_UPDATE') {
    tempElement.textContent = formatReading(payload.temperature, '°C');
    humElement.textContent = formatReading(payload.humidity, '%');
    renderChartState(Array.isArray(payload.history) ? payload.history : []);
  } else if (topic === 'CASA/TEM') {
    tempElement.textContent = formatReading(parseFloat(payload), '°C');
  } else if (topic === 'CASA/HUM') {
    humElement.textContent = formatReading(parseFloat(payload), '%');
  } else if (topic === 'CASA/ESTADO_LUZ') {
    luzValueElement.textContent = `${payload}%`;
    sliderLuz.value = payload;
  } else if (['CASA/FLAMA', 'CASA/TERREMOTO', 'CASA/PROX', 'CASA/SONIDO'].includes(topic)) {
    agregarAlerta(topic, payload);
  }
});

// Control de iluminación (Frontend -> Backend -> MQTT)
sliderLuz.addEventListener('change', (e) => {
  const valor = e.target.value;
  luzValueElement.textContent = `${valor}%`;
  socket.emit('set_luz', valor);
});

function agregarAlerta(topico, mensaje) {
  const li = document.createElement('li');
  li.className = 'list-group-item list-group-item-danger d-flex justify-content-between align-items-center';
  const fecha = new Date().toLocaleTimeString();
  li.innerHTML = `<strong>[${topico}]</strong> ${mensaje} <span class="badge bg-dark">${fecha}</span>`;
  alertsList.prepend(li);
}