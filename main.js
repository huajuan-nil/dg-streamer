const { app, BrowserWindow, ipcMain } = require('electron')

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-experimental-web-platform-features', true)
} else {
  app.commandLine.appendSwitch('enable-web-bluetooth', true)
}

function createWindow () {
  const mainWindow = new BrowserWindow({
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  let selectDeviceCallback
  const devices = {}
  mainWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault()
    deviceList.forEach(device => { devices[device.deviceId] = device })

    selectDeviceCallback = callback
  })

  ipcMain.handle('bluetooth:pullDevices', () => Object.values(devices))
  ipcMain.handle('bluetooth:selectDevice', (event, deviceId) => selectDeviceCallback(deviceId))

  mainWindow.loadFile('index.html')

  mainWindow.webContents.openDevTools()
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})
