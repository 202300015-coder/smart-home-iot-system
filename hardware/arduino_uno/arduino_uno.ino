#include <SoftwareSerial.h>
#include <DHT.h>

// ==================== CONFIGURACIÓN SENSOR DHT ====================
#define PIN_DHT          2        // Digital 2
#define DHTTYPE          DHT11    // Cambia a DHT22 si tu sensor es el módulo blanco
DHT dht(PIN_DHT, DHTTYPE);

// ==================== COMUNICACIÓN SERIE GATEWAY ====================
// RX = A0 (Pin 14), TX = Pin 8 (Divisor 5V->3.3V al RX del ESP8266)
SoftwareSerial espSerial(14, 8); 

// ==================== MAPEADO DE PINES ====================
#define PIN_KY017_SISMO   3   // Digital 3 (INT1)
#define PIN_HALL_PUERTA   4   // Digital 4 (Sensor Hall KY-003)
#define PIN_BUZZER       7   // Digital 7 (Buzzer)

// KY-009 LED RGB SMD (Alertas / Eventos Exclusivamente)
#define KY009_R          6   // PWM
#define KY009_G          9   // PWM
#define KY009_B          10  // PWM

// KY-016 LED RGB (Luz Ambiental - Exclusivamente Canal Rojo en Pin 11)
#define KY016_R          11  // PWM

// Sensor Big Sound (Sonido)
#define PIN_SONIDO_AO    A1  // Analógico A1
#define PIN_SONIDO_DO    A2  // Digital / A2

// Potenciómetro B10K
#define PIN_POTENTIOMETER A3 // Analógico A3

// SENSOR FLAMA KY-026 (Lectura Analógica)
#define PIN_FLAMA_AO     A4 // Analógico A4

// ==================== CONFIGURACIÓN Y LÓGICA ====================
const unsigned long VENTANA_SISMO       = 2000;    
const unsigned long INTERVALO_DHT       = 5000;    
const unsigned long DEBOUNCE_ALERT      = 3000;     
const unsigned long TIEMPO_MINIMO_FLAMA = 300; // 300ms de presencia sostenida

#define ESTADO_PUERTA_ABIERTA HIGH 

// --- UMBRAL ANALÓGICO PARA FLAMA ---
// Menos de 400 = Fuego detectado (Valores normales ambientales suelen ser 700-1000)
const int UMBRAL_FLAMA = 800; 

// ==================== VARIABLES GLOBALES ====================
volatile int contadorImpactosSismo = 0;
volatile unsigned long tiempoPrimerImpacto = 0;

unsigned long timerAlertaFlama = 0;
unsigned long timerInicioFlama = 0;
unsigned long timerAlertaSismo = 0;
unsigned long timerAlertaPuerta = 0;
unsigned long timerAlertaSonido = 0;

// --- Puerta con debounce anti-ruido ---
bool estadoPuertaConfirmado   = !ESTADO_PUERTA_ABIERTA; // estado ya validado
bool ultimaLecturaPuertaRaw   = !ESTADO_PUERTA_ABIERTA; // última lectura cruda del pin
unsigned long tiempoUltimoCambioPuerta = 0;
const unsigned long DEBOUNCE_PUERTA_MS = 50; // tiempo que debe mantenerse estable la lectura

int baseSonido = -1;
bool sonidoBloqueado = false;
unsigned long tiempoBloqueoSonido = 0;

int ultimoBrilloPot = -1;
int brilloLuzActual = 0;
unsigned long timerPot = 0;
unsigned long timerDHT = 0;

enum EstadoAlarma { IDLE, ALARMA_FLAMA, ALARMA_SISMO, ALARMA_PUERTA, ALARMA_SONIDO };
EstadoAlarma alarmaActual = IDLE;
unsigned long timerAlarmaStep = 0;
uint8_t pasoAlarma = 0;

// Declaración de Funciones
void setKY009(uint8_t r, uint8_t g, uint8_t b);
void setKY016(uint8_t r);
int leerAnalogicoLimpio(uint8_t pin);
void notificarEvento(String mensajeHumano, String tramaGateway);
void procesarComandosSerial();
void actualizarAlarmasVisualesSonoras();
void leerPotenciometro();
void leerSensores();

// ISR SISMO
void ISR_KY017_Sismo() {
  unsigned long ahora = millis();
  if (contadorImpactosSismo == 0) {
    tiempoPrimerImpacto = ahora;
  }
  contadorImpactosSismo++;
}

void setup() {
  Serial.begin(9600);      
  espSerial.begin(9600);    

  dht.begin();

  pinMode(PIN_KY017_SISMO, INPUT_PULLUP);
  pinMode(PIN_HALL_PUERTA, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);

  // LED KY-009 (Alertas)
  pinMode(KY009_R, OUTPUT);
  pinMode(KY009_G, OUTPUT);
  pinMode(KY009_B, OUTPUT);

  // LED KY-016 (Únicamente Pin 11)
  pinMode(KY016_R, OUTPUT);

  pinMode(PIN_SONIDO_DO, INPUT_PULLUP);

  attachInterrupt(digitalPinToInterrupt(PIN_KY017_SISMO), ISR_KY017_Sismo, FALLING);

  // Leer estado inicial de la puerta
  estadoPuertaConfirmado = digitalRead(PIN_HALL_PUERTA);
  ultimaLecturaPuertaRaw = estadoPuertaConfirmado;

  // Estado Inicial: Apagados
  setKY009(0, 0, 0);
  setKY016(0);
  noTone(PIN_BUZZER);

  Serial.println(F("\n=============================================="));
  Serial.println(F("  [ARDUINO UNO] Sistema Listo                 "));
  Serial.println(F("  KY-026: Lectura Analógica en Pin A4         "));
  Serial.println(F("  Umbral de Flama: < 400                      "));
  Serial.println(F("==============================================\n"));
}

void loop() {
  leerSensores();
  leerPotenciometro();
  procesarComandosSerial();
  actualizarAlarmasVisualesSonoras();
}

// ==================== CONTROL DE ACTUADORES ====================
void setKY009(uint8_t r, uint8_t g, uint8_t b) {
  analogWrite(KY009_R, r);
  analogWrite(KY009_G, g);
  analogWrite(KY009_B, b);
}

void setKY016(uint8_t r) {
  analogWrite(KY016_R, r);
}

int leerAnalogicoLimpio(uint8_t pin) {
  analogRead(pin); 
  delayMicroseconds(200);
  return analogRead(pin);
}

void notificarEvento(String mensajeHumano, String tramaGateway) {
  Serial.print(F("[ALERTA] "));
  Serial.println(mensajeHumano);
  espSerial.println(tramaGateway);
}

// ==================== LECTURA DE SENSORES ====================
void leerSensores() {
  unsigned long ahora = millis();

  // 1. EVALUAR SISMO (KY-017)
  if (contadorImpactosSismo > 0) {
    if (ahora - tiempoPrimerImpacto <= VENTANA_SISMO) {
      if (contadorImpactosSismo >= 5) {
        if (ahora - timerAlertaSismo > DEBOUNCE_ALERT) {
          timerAlertaSismo = ahora;
          notificarEvento("¡Sismo / Vibración Detectada!", "ALERT:TERREMOTO");
          alarmaActual = ALARMA_SISMO;
          pasoAlarma = 0;
          timerAlarmaStep = ahora;
        }
        contadorImpactosSismo = 0;
      }
    } else {
      contadorImpactosSismo = 0;
    }
  }

  // 2. EVALUAR FLAMA ANALÓGICO (KY-026 en Pin A4)
  int valorFlama = leerAnalogicoLimpio(PIN_FLAMA_AO);
  
  if (valorFlama < UMBRAL_FLAMA) {
    if (timerInicioFlama == 0) {
      timerInicioFlama = ahora;
    } else if (ahora - timerInicioFlama >= TIEMPO_MINIMO_FLAMA) {
      if (ahora - timerAlertaFlama > DEBOUNCE_ALERT) {
        timerAlertaFlama = ahora;
        
        String msj = "¡Flama / Fuego Detectado! (Lectura A4: " + String(valorFlama) + ")";
        notificarEvento(msj, "ALERT:FLAMA");
        
        alarmaActual = ALARMA_FLAMA;
        pasoAlarma = 0;
        timerAlarmaStep = ahora;
      }
    }
  } else {
    timerInicioFlama = 0;
  }

  // 3. EVALUAR PUERTA MAGNÉTICA (KY-003) - CON DEBOUNCE ANTI-RUIDO
  bool lecturaPuertaRaw = digitalRead(PIN_HALL_PUERTA);

  // Si la lectura cruda cambió respecto a la anterior, reinicia el cronómetro de estabilidad
  if (lecturaPuertaRaw != ultimaLecturaPuertaRaw) {
    tiempoUltimoCambioPuerta = ahora;
    ultimaLecturaPuertaRaw = lecturaPuertaRaw;
  }

  // Solo aceptamos el cambio si la lectura se mantuvo IGUAL durante DEBOUNCE_PUERTA_MS
  if ((ahora - tiempoUltimoCambioPuerta) > DEBOUNCE_PUERTA_MS) {
    if (lecturaPuertaRaw != estadoPuertaConfirmado) {
      estadoPuertaConfirmado = lecturaPuertaRaw; // ahora sí es un cambio real y estable

      if (estadoPuertaConfirmado == ESTADO_PUERTA_ABIERTA) {
        notificarEvento("¡Puerta Abierta! (Imán no detectado)", "ALERT:PROX");
        alarmaActual = ALARMA_PUERTA;
        pasoAlarma = 0;
        timerAlarmaStep = ahora;
      } else {
        Serial.println(F("[ESTADO] Puerta Cerrada (Imán Detectado)"));
      }
    }
  }

  // 4. EVALUAR SONIDO (BIG SOUND)
  int valSonidoAO = leerAnalogicoLimpio(PIN_SONIDO_AO);
  if (baseSonido < 0) baseSonido = valSonidoAO;
  int diffSonido = abs(valSonidoAO - baseSonido);

  bool detectoSonido = (valSonidoAO > 820 || diffSonido > 250);

  if (detectoSonido && !sonidoBloqueado) {
    sonidoBloqueado = true;
    tiempoBloqueoSonido = ahora;
    if (ahora - timerAlertaSonido > DEBOUNCE_ALERT) {
      timerAlertaSonido = ahora;
      notificarEvento("¡Ruido Fuerte Detectado!", "ALERT:SONIDO");
      alarmaActual = ALARMA_SONIDO;
      pasoAlarma = 0;
      timerAlarmaStep = ahora;
    }
  }
  if (!detectoSonido && sonidoBloqueado && (ahora - tiempoBloqueoSonido > 2000)) {
    sonidoBloqueado = false;
  }
  if (!detectoSonido && !sonidoBloqueado) {
    baseSonido = ((baseSonido * 15) + valSonidoAO) / 16;
  }

  // 5. ENVÍO DE TELEMETRÍA DHT
  if (ahora - timerDHT >= INTERVALO_DHT) {
    timerDHT = ahora;

    float hum = dht.readHumidity();
    float temp = dht.readTemperature();

    if (isnan(hum) || isnan(temp)) {
      Serial.println(F("[ERROR DHT] Error al leer los datos del sensor DHT. Revisa las conexiones."));
    } else {
      Serial.println("[INFO] Telemetría -> Temp: " + String(temp, 1) + "°C | Hum: " + String(hum, 1) + "%");
      espSerial.println("DATA:TEMP:" + String(temp, 1));
      espSerial.println("DATA:HUM:" + String(hum, 1));
    }
  }
}

// ==================== LEER POTENCIÓMETRO ====================
void leerPotenciometro() {
  if (millis() - timerPot < 150) return;
  timerPot = millis();

  int lecturaRaw = leerAnalogicoLimpio(PIN_POTENTIOMETER);
  int valPWM = map(lecturaRaw, 0, 1023, 0, 255);

  if (abs(valPWM - ultimoBrilloPot) >= 8) { 
    ultimoBrilloPot = valPWM;
    brilloLuzActual = valPWM;
    
    setKY016(brilloLuzActual);
    
    Serial.println("[POT] Brillo KY-016 (Pin 11): " + String(brilloLuzActual));
    espSerial.println("DATA:LUZ:" + String(brilloLuzActual));
  }
}

// ==================== RECEPCIÓN ESP8266 ====================
void procesarComandosSerial() {
  if (espSerial.available()) {
    String comando = espSerial.readStringUntil('\n');
    comando.trim();

    if (comando.startsWith("SET_LUZ:")) {
      int nuevoValor = comando.substring(8).toInt();
      brilloLuzActual = constrain(nuevoValor, 0, 255);
      ultimoBrilloPot = brilloLuzActual; 
      
      setKY016(brilloLuzActual);
      Serial.println("[COMANDO ESP] Ajustar Luz KY-016 a: " + String(brilloLuzActual));
    }
  }
}

// ==================== MÁQUINA DE ESTADOS: ALERTAS ====================
void actualizarAlarmasVisualesSonoras() {
  if (alarmaActual == IDLE) {
    setKY009(0, 0, 0);
    noTone(PIN_BUZZER);
    return;
  }

  unsigned long transcurrido = millis() - timerAlarmaStep;

  switch (alarmaActual) {
    case ALARMA_FLAMA: 
      if (pasoAlarma == 0) {
        setKY009(255, 0, 0); 
        tone(PIN_BUZZER, 200);
        if (transcurrido >= 400) { pasoAlarma = 1; timerAlarmaStep = millis(); }
      } else if (pasoAlarma == 1) {
        setKY009(0, 0, 0);
        noTone(PIN_BUZZER);
        if (transcurrido >= 200) { pasoAlarma = 2; timerAlarmaStep = millis(); }
      } else {
        alarmaActual = IDLE;
      }
      break;

    case ALARMA_SISMO: 
      if (pasoAlarma == 0) {
        setKY009(128, 0, 128);
        tone(PIN_BUZZER, 800);
        if (transcurrido >= 500) { pasoAlarma = 1; timerAlarmaStep = millis(); }
      } else if (pasoAlarma == 1) {
        setKY009(0, 0, 0);
        noTone(PIN_BUZZER);
        if (transcurrido >= 200) { pasoAlarma = 2; timerAlarmaStep = millis(); }
      } else {
        alarmaActual = IDLE;
      }
      break;

    case ALARMA_PUERTA: 
      if (pasoAlarma == 0) {
        setKY009(0, 255, 0); 
        tone(PIN_BUZZER, 1200);
        if (transcurrido >= 300) { pasoAlarma = 1; timerAlarmaStep = millis(); }
      } else {
        setKY009(0, 0, 0);
        noTone(PIN_BUZZER);
        alarmaActual = IDLE;
      }
      break;

    case ALARMA_SONIDO: 
      if (pasoAlarma == 0) {
        setKY009(0, 0, 255); 
        tone(PIN_BUZZER, 600);
        if (transcurrido >= 300) { pasoAlarma = 1; timerAlarmaStep = millis(); }
      } else {
        setKY009(0, 0, 0);
        noTone(PIN_BUZZER);
        alarmaActual = IDLE;
      }
      break;

    default:
      setKY009(0, 0, 0);
      noTone(PIN_BUZZER);
      alarmaActual = IDLE;
      break;
  }
}