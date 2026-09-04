# ⚡ FoxySwitch

[![Platform](https://img.shields.io/badge/Platform-ESP32%20%7C%20Arduino-E7352C.svg?logo=espressif&logoColor=white)](arduino)
[![Backend](https://img.shields.io/badge/Backend-Node.js%20%7C%20TypeScript-3178C6.svg?logo=typescript&logoColor=white)](server)
[![Status](https://img.shields.io/badge/Status-Legacy%20Firmware-orange.svg)](#background)
[![Successor](https://img.shields.io/badge/Next%20Gen-Home%20Assistant%20%7C%20ESPHome-41BDF5.svg?logo=homeassistant&logoColor=white)](https://esphome.io/)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/resonaura)

Software and embedded firmware ecosystem for an ESP32-based DIY smart home wall switch with companion management server.

---

## 🏡 Background & Evolution

**FoxySwitch** was designed and built as a bespoke smart switch solution before transitioning to **Home Assistant** and **ESPHome**.

It decoupled physical relay handling from remote control, enabling seamless physical click feedback, network state synchronization, and touch capacitive interaction.

---

## 📦 Repository Structure

- **`arduino/`**: ESP32 C++ firmware handling physical relay actuation, button interrupt debouncing, status LED signaling, and bidirectional WebSocket/HTTP communications.
- **`server/`**: Lightweight Node.js/TypeScript backend acting as the bridge coordinator and dispatching remote state commands.
