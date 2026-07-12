// Goa project config. Editing this file cannot affect any other project —
// engine.js and style.css are the only shared code.
// Goa differs from Manipur: no "Form Version" column, has an "Income" column.
// The engine adapts automatically from the column map below.
window.CATI_PROJECT = {
  name: 'Goa',
  csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSxDHq7tyNuJ5j29PLODgV43VmkPXhLCx6Lv5yaChJkphbSZx5TTVfHqLwOixewBNSjZmcb6jptA6ed/pub?gid=827130388&single=true&output=csv',

  target: 2400,          // overall (40 ACs × 60)
  perAcTarget: 60,       // uniform per-constituency target → drives the AC Target Tracker
  startDate: '2026-07-04',
  deadline: '2026-07-06',

  // Header names exactly as they appear in the Goa sheet. No formVersion here.
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
    ge2024: '2024 GE',
    caste: 'Caste',
    income: 'Income',
    autoQC: 'Auto QC',
    finalCall: 'Final Call',
    qcMemberVendor: 'QC Member (Vendor)',
    sampleQualityVendor: 'Sample Quality (Vendor)',
    qcMemberInternal: 'QC Member (Internal)',
    sampleQualityInternal: 'Sample Quality (Internal)'
  },

  validValue: 'Valid'
};
