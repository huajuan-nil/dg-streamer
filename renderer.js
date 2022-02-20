const { ipcRenderer } = require('electron')

const { OpenDGLab, WaveCenter } = require('OpenDGLab')

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const ui = {
  device: {
    _: document.getElementById('devices'),
    message: document.getElementById('devices-msg'),
    scan: document.getElementById('devices-scan'),
    disconnect: document.getElementById('devices-disconnect'),
    list: document.getElementById('devices-list'),
    status: document.getElementById('devices-status'),
    status_battery: document.getElementById('devices-status-battery'),
    status_channelA: document.getElementById('devices-status-channel_a'),
    status_channelB: document.getElementById('devices-status-channel_b')
  },
  control: {
    _: document.getElementById('control'),
    a_strength: document.getElementById('control-a-strength'),
    a_wave: document.getElementById('control-a-wave'),
    b_strength: document.getElementById('control-b-strength'),
    b_wave: document.getElementById('control-b-wave')
  }
}

const dgble = {
  state: 'disconnected',
  device: null,
  server: null,
  services: null,
  characteristic: null
}

const dglab = new OpenDGLab()

async function scan () { // eslint-disable-line no-unused-vars
  ui.device.scan.style.display = 'none'
  ui.device.message.innerText = 'Scanning for Bluetooth devices...'
  ui.device.message.style.display = 'block'
  ui.device.disconnect.style.display = 'none'

  navigator.bluetooth.requestDevice({
    filters: [{
      name: OpenDGLab.Device.Companion.getName()
    }],
    optionalServices: OpenDGLab.Device.Companion.services()
  }).then(target => { dgble.device = target })

  while (dgble.state === 'disconnected') {
    const devices = await ipcRenderer.invoke('bluetooth:pullDevices')

    ui.device.list.innerHTML = `${devices
      .sort((lhs, rhs) => lhs.deviceName - rhs.deviceName)
      .map(device =>
        `<li>
            <input type="button" value="Select" onclick="connect('${device.deviceId}').catch(alert)"/> 
            <span>${device.deviceName} (${device.deviceId})</span>
        </li>`
      )
      .join('')}`
    ui.device.list.display = 'block'
    await sleep(500)
  }

  ui.device.list.style.display = 'none'
}

async function connect (bluetoothId) { // eslint-disable-line no-unused-vars
  dgble.state = 'connecting'
  ui.device.message.innerText = 'Connecting...'

  await ipcRenderer.invoke('bluetooth:selectDevice', bluetoothId)
  while (!dgble.device) {
    await sleep(500)
  }

  dgble.server = await dgble.device.gatt.connect()

  dgble.services = {
    device: await dgble.server.getPrimaryService(OpenDGLab.DeviceStatus.Companion.getUUID()),
    eStim: await dgble.server.getPrimaryService(OpenDGLab.EStimStatus.Companion.getUUID())
  }
  dgble.services.device = await dgble.server.getPrimaryService(OpenDGLab.DeviceStatus.Companion.getUUID())
  dgble.services.eStim = await dgble.server.getPrimaryService(OpenDGLab.EStimStatus.Companion.getUUID())

  dgble.characteristic = {
    device: {
      electric: await dgble.services.device.getCharacteristic(OpenDGLab.DeviceStatus.Electric.Companion.getUUID())
    },
    eStim: {
      abpower: await dgble.services.eStim.getCharacteristic(OpenDGLab.EStimStatus.ABPower.Companion.getUUID()),
      waveA: await dgble.services.eStim.getCharacteristic(OpenDGLab.EStimStatus.Wave.Companion.getUUIDA()),
      waveB: await dgble.services.eStim.getCharacteristic(OpenDGLab.EStimStatus.Wave.Companion.getUUIDB())
    }
  }

  dgble.state = 'connected'
  ui.device.message.innerText = `Connected to ${dgble.device.name} (${dgble.device.id})`
  ui.device.disconnect.style.display = 'block'

  await dgble.characteristic.device.electric.startNotifications()
  dgble.characteristic.device.electric.addEventListener('characteristicvaluechanged', event => {
    const data = Array.from(new Uint8Array(event.target.value.buffer))
    ui.device.status_battery.innerText = dglab.deviceStatus.electric.onChange(data)
  })

  const { buffer } = await dgble.characteristic.device.electric.readValue()
  ui.device.status_battery.innerText = dglab.deviceStatus.electric.read(Array.from(new Uint8Array(buffer)))

  await dgble.characteristic.eStim.abpower.startNotifications()
  dgble.characteristic.eStim.abpower.addEventListener('characteristicvaluechanged', event => {
    const data = Array.from(new Uint8Array(event.target.value.buffer))
    dglab.eStimStatus.abPower.onChange(data)
    ui.device.status_channelA.innerText = dglab.eStimStatus.abPower.getAPower()
    ui.device.status_channelB.innerText = dglab.eStimStatus.abPower.getBPower()
  })

  const power = dglab.eStimStatus.abPower.setABPower(0, 0)
  dgble.characteristic.eStim.abpower.writeValueWithoutResponse(Uint8Array.from(power.data))

  ui.device.status.style.display = 'block'
}

async function disconnect () { // eslint-disable-line no-unused-vars
  dgble.state = 'disconnecting'
  ui.device.message.innerText = 'Disconnecting'

  dgble.device.addEventListener('gattserverdisconnected', () => {
    dgble.device = null
    dgble.server = null
    dgble.services = null
    dgble.characteristic = null
    dgble.state = 'disconnected'

    ui.device.scan.style.display = 'block'
    ui.device.disconnect.style.display = 'none'
    ui.device.message.style.display = 'none'
    ui.device.status.style.display = 'none'
  })

  dgble.device.gatt.disconnect()
}

(() => {
  for (const i of ['a', 'b']) {
    ui.control[i + '_strength'].addEventListener('change', (event) => {
      const strength = Math.min(event.target.value, 274)
      const power = dglab.eStimStatus.abPower.setABPower(i === 'a' ? strength : ui.control.a_strength.value, i === 'b' ? strength : ui.control.b_strength.value)
      dgble.characteristic.eStim.abpower.writeValueWithoutResponse(Uint8Array.from(power.data))
    })

    const center = i === 'a' ? dglab.eStimStatus.wave.getWaveCenterA() : dglab.eStimStatus.wave.getWaveCenterB()
    ui.control[i + '_wave'].addEventListener('change', (event) => {
      const wave = WaveCenter.Companion.getBasicWave(event.target.value)
      center.selectWave(null)
      center.selectWave(wave)
    })

    setInterval(() => {
      const buffer = center.waveTick()
      if (buffer) {
        // XXX: for some reason, you need to use the waveB characteristic for channel A
        if (i === 'a') {
          dgble.characteristic.eStim.waveB.writeValueWithoutResponse(Uint8Array.from(buffer))
        } else {
          dgble.characteristic.eStim.waveA.writeValueWithoutResponse(Uint8Array.from(buffer))
        }
      }
    }, 100)
  }
})()
