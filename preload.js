const { contextBridge, ipcRenderer, webUtils } = require('electron');
const inv = (c, a) => ipcRenderer.invoke(c, a);
contextBridge.exposeInMainWorld('api', {
  printers: () => inv('printers:list'), test: a => inv('printers:test', a), purge: n => inv('printers:purge', n),
  pick: () => inv('file:pick'), info: p => inv('file:info', p), save: a => inv('file:save', a),
  get: () => inv('store:get'), set: d => inv('store:set', d),
  run: j => inv('job:run', j), cancel: id => inv('job:cancel', id),
  dataInfo: () => inv('data:info'), dataOpen: () => inv('data:open'), dataExport: () => inv('data:export'), dataImport: () => inv('data:import'),
  pathOf: f => webUtils.getPathForFile(f)
});
