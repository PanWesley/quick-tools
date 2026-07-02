(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TodayYouxuExport = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  function copyList(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function buildExportPayload(data, exportedAt) {
    var source = data || {};
    return {
      app: 'today-youxu',
      version: 1,
      exportedAt: exportedAt || new Date().toISOString(),
      tasks: copyList(source.tasks),
      habits: copyList(source.habits),
      habitLogs: copyList(source.habitLogs),
      journals: copyList(source.journals),
      opLogs: copyList(source.opLogs)
    };
  }

  function downloadJson(payload, filename) {
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename || 'today-youxu-export.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return {
    buildExportPayload: buildExportPayload,
    downloadJson: downloadJson
  };
});
