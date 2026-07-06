// Manipur project config. Editing this file cannot affect any other project —
// engine.js and style.css are the only shared code.
window.CATI_PROJECT = {
  name: 'Manipur',
  csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTu9Tsu3huiYOe9T847M3AL4fW5M4x2VH3Vxybe0uI6CfriKnSjZUfCkZpfPDqFENbtKii9hjhcCuCT/pub?gid=1610357481&single=true&output=csv',

  target: 1200,
  startDate: '2026-07-04',   // yyyy-mm-dd
  deadline: '2026-07-06',    // yyyy-mm-dd

  // Header names exactly as they appear in the Samples sheet.
  columns: {
    vendor: 'Vendor',
    formVersion: 'Form Version',
    timestamp: 'Timestamp',
    agentId: 'Agent ID',
    mobile: 'Mobile',
    gender: 'Gender',
    age: 'Age',
    ac: 'AC',
    voteNow: 'Vote Now',
    ae2022: '2022 AE',
    ge2024: '2024 GE',
    caste: 'Caste',
    autoQC: 'Auto QC',
    finalCall: 'Final Call',
    qcMemberVendor: 'QC Member (Vendor)',
    sampleQualityVendor: 'Sample Quality (Vendor)',
    qcMemberInternal: 'QC Member (Internal)',
    sampleQualityInternal: 'Sample Quality (Internal)'
  },

  validValue: 'Valid'
};
