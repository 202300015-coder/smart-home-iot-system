const socket = io();

// Elementos DOM
const tempEl = document.getElementById('temp');
const humEl = document.getElementById('hum');
const luzValEl = document.getElementById('luz-val');
const sliderLuz = document.getElementById('slider-luz');
const statusEl = document.getElementById('status');

// Elementos de la Gráfica SVG
const tempPath = document.getElementById('temperatureLine');
const humPath = document.getElementById('humidityLine');
const placeholder = document.getElementById('chart-placeholder');

// Textos de min, mid, max
const tempMax = document.getElementById('tempMaxValue');
const tempMid = document.getElementById('tempMidValue');
const tempMin = document.getElementById('tempMinValue');
const humMax = document.getElementById('humMaxValue');
const humMid = document.getElementById('humMidValue');
const humMin = document.getElementById('humMinValue');

// Eventos de Socket.io
socket.on('connect', () => {
  if (statusEl) {
    statusEl.setAttribute('data-state', 'connected');
    statusEl.querySelector('b').textContent = 'Conectado';
  }
});

socket.on('disconnect', () => {
  if (statusEl) {
    statusEl.setAttribute('data-state', 'disconnected');
    statusEl.querySelector('b').textContent = 'Desconectado';
  }
});

socket.on('mqtt_data', (data) => {
  const { topic, payload } = data;

  if (topic === 'CHART_UPDATE') {
    if (payload.temperature !== null && tempEl) tempEl.textContent = payload.temperature;
    if (payload.humidity !== null && humEl) humEl.textContent = payload.humidity;
    renderChart(payload.history || []);
  } else if (topic === 'CASA/TEM' && tempEl) {
    tempEl.textContent = payload;
  } else if (topic === 'CASA/HUM' && humEl) {
    humEl.textContent = payload;
  } else if (topic === 'CASA/ESTADO_LUZ' && luzValEl) {
    luzValEl.textContent = payload;
  }
});

// Enviar comandos de dimerización
if (sliderLuz) {
  sliderLuz.addEventListener('change', (e) => {
    socket.emit('set_luz', e.target.value);
  });
}

// ===================================================
// LÓGICA DE ESCALA Y BÉZIER PARA GRÁFICA SVG
// ===================================================
function scaleFor(values, minSpan = 2.0) {
  const valid = values.filter(v => v !== null && !isNaN(v));
  if (valid.length === 0) return { min: 0, max: 10, range: 10 };

  let min = Math.min(...valid);
  let max = Math.max(...valid);

  // Forzar un rango mínimo absoluto para evitar líneas totalmente planas o oscilaciones gigantes
  if (max - min < minSpan) {
    const center = (max + min) / 2;
    min = center - (minSpan / 2);
    max = center + (minSpan / 2);
  }

  return { min, max, range: max - min };
}

// Genera un D-path suavizado mediante curvas Bézier cúbicas
function lineForBezier(points) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;

  let d = `M ${points[0].x},${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }

  return d;
}

function renderChart(history) {
  if (!history || history.length < 2) {
    if (placeholder) placeholder.style.display = 'block';
    return;
  }

  if (placeholder) placeholder.style.display = 'none';

  const width = 700;
  const height = 220;
  const paddingY = 30;
  const usableHeight = height - (paddingY * 2);

  const temps = history.map(h => h.temperature);
  const hums = history.map(h => h.humidity);

  const scaleTemp = scaleFor(temps, 2.0); // Mínimo 2°C de ventana
  const scaleHum = scaleFor(hums, 5.0);   // Mínimo 5% de ventana

  // Actualizar métricas textuales en el SVG
  if (tempMax) tempMax.textContent = scaleTemp.max.toFixed(1) + '°C';
  if (tempMid) tempMid.textContent = ((scaleTemp.max + scaleTemp.min) / 2).toFixed(1) + '°C';
  if (tempMin) tempMin.textContent = scaleTemp.min.toFixed(1) + '°C';

  if (humMax) humMax.textContent = scaleHum.max.toFixed(1) + '%';
  if (humMid) humMid.textContent = ((scaleHum.max + scaleHum.min) / 2).toFixed(1) + '%';
  if (humMin) humMin.textContent = scaleHum.min.toFixed(1) + '%';

  const stepX = width / (history.length - 1);

  const tempPoints = [];
  const humPoints = [];

  history.forEach((item, index) => {
    const x = index * stepX;

    if (item.temperature !== null) {
      const yTemp = height - paddingY - ((item.temperature - scaleTemp.min) / scaleTemp.range) * usableHeight;
      tempPoints.push({ x, y: yTemp });
    }

    if (item.humidity !== null) {
      const yHum = height - paddingY - ((item.humidity - scaleHum.min) / scaleHum.range) * usableHeight;
      humPoints.push({ x, y: yHum });
    }
  });

  if (tempPath) tempPath.setAttribute('d', lineForBezier(tempPoints));
  if (humPath) humPath.setAttribute('d', lineForBezier(humPoints));
}