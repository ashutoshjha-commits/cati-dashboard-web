// Manipur project config. Editing this file cannot affect any other project —
// engine.js and style.css are the only shared code.
// This is a CANDIDATE survey: 2022 AE is "PARTY (Candidate)" (rolled up to
// party), and MLA Candidate / INC Candidate are monitored at candidate level.
window.CATI_PROJECT = {
  name: 'Manipur',
  csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRFpNeye0PdwJQOwosiouaSFIKzLxlTs060I8dc1sseKPUNmwvukVd8meKXhuNJpydI_9vDKqd8Fa9r/pub?gid=1360204096&single=true&output=csv',

  target: 1200,
  startDate: '2026-07-04',   // yyyy-mm-dd
  deadline: '2026-07-20',    // yyyy-mm-dd

  // Candidate-survey behaviour.
  ae2022GroupByParty: true,  // roll "BJP (Karam Shyam)" up to "BJP"
  defaultCut: 'AC',          // candidate charts read best cut by constituency

  // AC-wise QC (drives the "AC-wise QC — Internal Rejection" section).
  // Closed = > closeThreshold valid (post Auto QC). Internal QC rejects samples
  // whose IM verdict equals internalRejectValue; those are also removed from
  // the analysis charts above.
  closeThreshold: 200,
  internalRejectValue: 'Invalid',
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
    mlaCandidate: 'MLA Candidate',
    incCandidate: 'INC Candidate',
    caste: 'Caste',
    autoQC: 'Auto QC',
    finalCall: 'Final Call',
    qcMemberVendor: 'QC Member (Vendor)',
    sampleQualityVendor: 'Sample Quality (Vendor)',
    // Internal QC verdict lives in the IM column (older "QC Member (Internal)"
    // is empty here). Non-blank = reviewed; equals internalRejectValue = rejected.
    qcMemberInternal: 'IM Final Call (Internal QC Verdict)',
    internalQCDone: 'IM Final Call (Internal QC Verdict)'
  },

  validValue: 'Valid'
};
