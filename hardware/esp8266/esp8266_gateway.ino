#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <WiFiClientSecure.h>
#include <SoftwareSerial.h>

// ==========================================
// 1. CREDENCIALES DE RED Y HIVEMQ
// ==========================================
const char* WIFI_SSID     = "INFINITUM68B3";
const char* WIFI_PASS     = "VcxUA4kKdY";

const char* MQTT_SERVER   = "fbae056b4d04427eb79a4f86a85ca7d7.s1.eu.hivemq.cloud";
const int   MQTT_PORT     = 8883;
const char* MQTT_USER     = "SERGIO";
const char* MQTT_PASS     = "123456789";

// SoftwareSerial para comunicarse con el Arduino Uno (RX: D5, TX: D6)
// Cambiamos de (14, 12) a (5, 4) -> D1 es RX, D2 es TX
SoftwareSerial arduinoSerial(5, 4);

WiFiClientSecure espClient;
PubSubClient client(espClient);

String tramaBuffer = "";
unsigned long lastMqttRetry = 0; // Para reconexión NO bloqueante

void setupWiFi() {
  delay(10);
  Serial.println();
  Serial.print("[WiFi] Conectando a ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\n[WiFi] ¡Conectado con éxito!");
  Serial.print("[WiFi] IP Asignada: ");
  Serial.println(WiFi.localIP());
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  
  Serial.println("==========================================");
  Serial.print("[MQTT RECIBIDO] Tópico: ");
  Serial.print(topic);
  Serial.print(" | Mensaje: ");
  Serial.println(message);
  Serial.println("==========================================");

  if (String(topic) == "CASA/LUZ") {
    String comando = "SET_LUZ:" + message;
    arduinoSerial.println(comando);
    Serial.print("[GATEWAY -> ARDUINO] Reenviado: ");
    Serial.println(comando);
  }
}

// Reconexión NO bloqueante
void reconnectMQTT() {
  unsigned long now = millis();
  if (now - lastMqttRetry > 5000) { // Intenta cada 5 segundos
    lastMqttRetry = now;
    
    if (WiFi.status() != WL_CONNECTED) {
      setupWiFi();
      return;
    }

    Serial.print("[MQTT] Conectando a HiveMQ Cloud...");
    String clientId = "ESP8266_Gateway_" + String(ESP.getChipId(), HEX);
    
    if (client.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println(" ¡CONECTADO!");
      client.subscribe("CASA/LUZ");
      Serial.println("[MQTT] Suscrito a: CASA/LUZ");
    } else {
      Serial.print(" Falló, rc=");
      Serial.print(client.state());
      Serial.println(" Reintentando en 5s...");
    }
  }
}

void procesarTrama(String trama) {
  trama.trim();
  if (trama.length() == 0) return;

  Serial.print("[ARDUINO -> GATEWAY] Trama recibida: ");
  Serial.println(trama);

  if (!client.connected()) return; // No intenta publicar si MQTT no está listo

  if (trama == "ALERT:FLAMA") {
    client.publish("CASA/FLAMA", "1");
  } 
  else if (trama == "ALERT:TERREMOTO") {
    client.publish("CASA/TERREMOTO", "1");
  } 
  else if (trama == "ALERT:PROX") {
    client.publish("CASA/PROX", "1");
  } 
  else if (trama == "ALERT:SONIDO") {
    client.publish("CASA/SONIDO", "1");
  } 
  else if (trama.startsWith("DATA:TEMP:")) {
    String val = trama.substring(10);
    client.publish("CASA/TEM", val.c_str());
  } 
  else if (trama.startsWith("DATA:HUM:")) {
    String val = trama.substring(9);
    client.publish("CASA/HUM", val.c_str());
  } 
  else if (trama.startsWith("DATA:LUZ:")) {
    String val = trama.substring(9);
    client.publish("CASA/ESTADO_LUZ", val.c_str());
  }
}

void setup() {
  Serial.begin(115200);      
  arduinoSerial.begin(2400); 

  espClient.setInsecure();   

  setupWiFi();
  client.setServer(MQTT_SERVER, MQTT_PORT);
  client.setCallback(mqttCallback);
}

void loop() {
  if (!client.connected()) {
    reconnectMQTT();
  } else {
    client.loop();
  }

  // LECTURA NO BLOQUEANTE DESDE ARDUINO
  while (arduinoSerial.available() > 0) {
    char c = (char)arduinoSerial.read();
    if (c == '\n') {
      procesarTrama(tramaBuffer);
      tramaBuffer = "";
    } else if (c != '\r') {
      tramaBuffer += c;
    }
  }
}