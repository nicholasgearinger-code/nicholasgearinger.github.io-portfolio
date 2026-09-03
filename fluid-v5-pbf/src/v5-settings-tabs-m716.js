// Fluid V5 M7.1.7 settings compatibility forwarder.
// M7.1.6 rebuilt the control DOM too early and could leave empty category pages.
// M7.1.7 preserves the proven existing live tab shell and only restyles it as a mobile modal.
await import('./v5-settings-modal-m717.js');
