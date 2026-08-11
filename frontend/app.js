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

  if (topic === 'CASA/TEM') {
    tempElement.textContent = `${payload} °C`;
  } else if (topic === 'CASA/HUM') {
    humElement.textContent = `${payload} %`;
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