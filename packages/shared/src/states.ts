/**
 * Indian states / union territories with GST state codes (first two digits of a GSTIN).
 * `code` follows ISO 3166-2:IN (2023 revision) and is the key used across the system.
 * The GST code decides CGST+SGST (intra-state) vs IGST (inter-state) on invoices.
 */
export const INDIAN_STATES = [
  { code: 'JK', name: 'Jammu and Kashmir', gstCode: '01', isUT: true },
  { code: 'HP', name: 'Himachal Pradesh', gstCode: '02', isUT: false },
  { code: 'PB', name: 'Punjab', gstCode: '03', isUT: false },
  { code: 'CH', name: 'Chandigarh', gstCode: '04', isUT: true },
  { code: 'UK', name: 'Uttarakhand', gstCode: '05', isUT: false },
  { code: 'HR', name: 'Haryana', gstCode: '06', isUT: false },
  { code: 'DL', name: 'Delhi', gstCode: '07', isUT: true },
  { code: 'RJ', name: 'Rajasthan', gstCode: '08', isUT: false },
  { code: 'UP', name: 'Uttar Pradesh', gstCode: '09', isUT: false },
  { code: 'BR', name: 'Bihar', gstCode: '10', isUT: false },
  { code: 'SK', name: 'Sikkim', gstCode: '11', isUT: false },
  { code: 'AR', name: 'Arunachal Pradesh', gstCode: '12', isUT: false },
  { code: 'NL', name: 'Nagaland', gstCode: '13', isUT: false },
  { code: 'MN', name: 'Manipur', gstCode: '14', isUT: false },
  { code: 'MZ', name: 'Mizoram', gstCode: '15', isUT: false },
  { code: 'TR', name: 'Tripura', gstCode: '16', isUT: false },
  { code: 'ML', name: 'Meghalaya', gstCode: '17', isUT: false },
  { code: 'AS', name: 'Assam', gstCode: '18', isUT: false },
  { code: 'WB', name: 'West Bengal', gstCode: '19', isUT: false },
  { code: 'JH', name: 'Jharkhand', gstCode: '20', isUT: false },
  { code: 'OD', name: 'Odisha', gstCode: '21', isUT: false },
  { code: 'CG', name: 'Chhattisgarh', gstCode: '22', isUT: false },
  { code: 'MP', name: 'Madhya Pradesh', gstCode: '23', isUT: false },
  { code: 'GJ', name: 'Gujarat', gstCode: '24', isUT: false },
  { code: 'DH', name: 'Dadra and Nagar Haveli and Daman and Diu', gstCode: '26', isUT: true },
  { code: 'MH', name: 'Maharashtra', gstCode: '27', isUT: false },
  { code: 'KA', name: 'Karnataka', gstCode: '29', isUT: false },
  { code: 'GA', name: 'Goa', gstCode: '30', isUT: false },
  { code: 'LD', name: 'Lakshadweep', gstCode: '31', isUT: true },
  { code: 'KL', name: 'Kerala', gstCode: '32', isUT: false },
  { code: 'TN', name: 'Tamil Nadu', gstCode: '33', isUT: false },
  { code: 'PY', name: 'Puducherry', gstCode: '34', isUT: true },
  { code: 'AN', name: 'Andaman and Nicobar Islands', gstCode: '35', isUT: true },
  { code: 'TS', name: 'Telangana', gstCode: '36', isUT: false },
  { code: 'AP', name: 'Andhra Pradesh', gstCode: '37', isUT: false },
  { code: 'LA', name: 'Ladakh', gstCode: '38', isUT: true },
] as const;

export type IndianStateCode = (typeof INDIAN_STATES)[number]['code'];

export const INDIAN_STATE_CODES = INDIAN_STATES.map((s) => s.code) as unknown as readonly [
  IndianStateCode,
  ...IndianStateCode[],
];
