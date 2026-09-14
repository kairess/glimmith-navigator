const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('navigatorAPI', {
  onState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
  locate: (puzzleId) => ipcRenderer.invoke('locate', puzzleId),
  reportTooltipWidth: (width) => ipcRenderer.send('tooltip-width', width),
  setMinimized: (minimized) => ipcRenderer.send('set-minimized', minimized),
});
