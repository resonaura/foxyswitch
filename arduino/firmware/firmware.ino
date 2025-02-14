#ifdef ESP8266 
 #include <ESP8266WiFi.h>
 #include <ESP8266HTTPClient.h>
#endif 
#ifdef ESP32   
 #include <WiFi.h>
 #include <HTTPClient.h>
#endif
#include "credentials.h" // Wi-Fi and API credentials

// Pins for voltage control
#define INPUT_PIN1 D5  
#define INPUT_PIN2 D6 
#define DEBOUNCE_DELAY 50  // Debounce delay (ms)

// State variables for pins
bool lastButtonState1 = LOW; // Previous stable state for pin 1
bool lastButtonState2 = LOW; // Previous stable state for pin 2
bool currentButtonState1 = LOW; // Current stable state for pin 1
bool currentButtonState2 = LOW; // Current stable state for pin 2
unsigned long lastDebounceTime1 = 0;
unsigned long lastDebounceTime2 = 0;

void setup() {
  Serial.begin(115200);

  // Configure pins as inputs with pull-down resistors
  pinMode(INPUT_PIN1, INPUT);
  pinMode(INPUT_PIN2, INPUT);

  // Connect to Wi-Fi
  WiFi.setHostname("foxyswitch");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.println("Connecting to WiFi...");
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.println("Attempting to connect...");
  }
  Serial.println("Connected to WiFi");
}

void loop() {
  handle_input(INPUT_PIN1, &lastButtonState1, &currentButtonState1, &lastDebounceTime1, 1);
  handle_input(INPUT_PIN2, &lastButtonState2, &currentButtonState2, &lastDebounceTime2, 2);

  delay(50); // Small delay for stability
}

// Function to handle input state changes
void handle_input(int pin, bool* lastButtonState, bool* currentButtonState, unsigned long* lastDebounceTime, int switch_number) {
  int reading = digitalRead(pin);

  // Check for state change with debounce
  if (reading != *currentButtonState) {
    *lastDebounceTime = millis(); // Reset debounce timer
    *currentButtonState = reading;
  }

  if ((millis() - *lastDebounceTime) > DEBOUNCE_DELAY) {
    // If the state has been stable for the debounce period
    if (*currentButtonState != *lastButtonState) {
      *lastButtonState = *currentButtonState;

      Serial.print("State on GPIO");
      Serial.print(pin);
      Serial.print(": ");
      if (*currentButtonState == HIGH) {
        Serial.println("Voltage detected.");
        // Voltage appeared on the pin
        control_switch(true, switch_number);
        Serial.printf("Switch %d turned on\n", switch_number);
      } else {
        Serial.println("No voltage detected.");
        // Voltage disappeared from the pin
        control_switch(false, switch_number);
        Serial.printf("Switch %d turned off\n", switch_number);
      }
    }
  }
}

// Function to control the switch via an HTTP request
void control_switch(bool turn_on, int switch_number) {
  WiFiClient client;
  HTTPClient http;
  String url = turn_on ? (API_HOST + "/switch/on/?switch=" + switch_number) : (API_HOST + "/switch/off/?switch=" + switch_number);

  // Check Wi-Fi connection
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected, trying to reconnect...");
    WiFi.reconnect();
    int retry_count = 0;
    while (WiFi.status() != WL_CONNECTED && retry_count < 10) {
      delay(1000);
      Serial.println("Reconnecting to WiFi...");
      retry_count++;
    }
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("Failed to reconnect to WiFi.");
      return; // Exit if reconnection fails
    } else {
      Serial.println("Reconnected to WiFi");
    }
  }

  Serial.print("Sending request to URL: ");
  Serial.println(url);

  // Initialize HTTPClient with WiFiClient
  http.begin(client, url);
  http.setTimeout(5000); // Set timeout to 5 seconds

  // Send GET request
  int httpResponseCode = http.GET();

  if (httpResponseCode == 200) {
    Serial.printf("Switch %d turned %s successfully\n", switch_number, turn_on ? "on" : "off");
  } else {
    Serial.printf("Failed to control switch %d: %d\n", switch_number, httpResponseCode);
    if (httpResponseCode == -1) {
      Serial.println("Error -1: Could not connect to the server. Check if the server is running.");
    } else {
      String errorResponse = http.getString();
      Serial.printf("Response: %s\n", errorResponse.c_str());
    }
  }

  http.end(); // Close connection
}
