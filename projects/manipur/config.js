// Manipur project config. Editing this file cannot affect any other project —
// engine.js and style.css are the only shared code.
window.CATI_PROJECT = {
  name: 'Manipur',
  csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRFpNeye0PdwJQOwosiouaSFIKzLxlTs060I8dc1sseKPUNmwvukVd8meKXhuNJpydI_9vDKqd8Fa9r/pub?gid=1360204096&single=true&output=csv',

  target: 1200,
  startDate: '2026-07-04',   // yyyy-mm-dd
  deadline: '2026-07-06',    // yyyy-mm-dd

  // AC closure & internal-QC tracking (drives the "AC Closure & QC" section).
  // An AC closes at > closeThreshold valid samples (after Auto QC); a closed AC
  // is counted internally-QCed once ≥ qcCoverageThreshold of its valid samples
  // carry an internal-QC verdict.
  closeThreshold: 200,
  qcCoverageThreshold: 0.30,
  acNameColumn: 'AC Name',

  // Header names exactly as they appear in the Tracker sheet.
  columns: {
    vendor: 'Vendor',
    timestamp: 'Timestamp',
    agentId: 'Agent ID',
    mobile: 'Mobile',
    gender: 'Gender',
    age: 'Age',
    ac: 'AC',
    voteNow: 'Vote Now',
    ae2022: '2022 AE',
    caste: 'Caste',
    autoQC: 'Auto QC',
    finalCall: 'Final Call',
    qcMemberVendor: 'QC Member (Vendor)',
    sampleQualityVendor: 'Sample Quality (Vendor)',
    // Internal QC on this sheet lives in the IM verdict column (the older
    // "QC Member (Internal)" column is unused / empty here).
    qcMemberInternal: 'IM Final Call (Internal QC Verdict)',
    internalQCDone: 'IM Final Call (Internal QC Verdict)'
  },

  validValue: 'Valid'
};
