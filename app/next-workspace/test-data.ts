export type DemoCustomer = { id: string; name: string; email: string; phone: string };
export type DemoItem = { id: string; name: string; price: number; tax: number };
export type DemoInvoice = { id: string; number: string; customerId: string; date: string; dueDate: string; total: number; paid: number; status: 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue'; sourceEstimateId?: string };
export type DemoEstimate = { id: string; number: string; customerId: string; date: string; validUntil: string; total: number; status: 'draft' | 'sent' | 'accepted' | 'converted' };
export type DemoReceipt = { id: string; number: string; invoiceId: string; customerId: string; date: string; amount: number; balanceAfter: number };

export const demoBusiness = { id: 'demo-business', name: 'Moneymatters Demo Business', role: 'Owner' };
export const demoCustomers: DemoCustomer[] = [
  { id: 'c1', name: 'Rahul Sharma', email: 'rahul@example.com', phone: '+91 98765 43210' },
  { id: 'c2', name: 'ABC Enterprises', email: 'accounts@abcenterprises.example', phone: '+91 98220 11223' },
  { id: 'c3', name: 'Mehta Electricals', email: 'office@mehtaelectricals.example', phone: '+91 97655 44556' },
];

export const demoItems: DemoItem[] = [
  { id: 'p1', name: 'Consulting Services', price: 15000, tax: 18 },
  { id: 'p2', name: 'Annual Maintenance', price: 24000, tax: 18 },
  { id: 'p3', name: 'Network Equipment', price: 8500, tax: 18 },
  { id: 'p4', name: 'Support Retainer', price: 12000, tax: 18 },
];

const seedInvoices: DemoInvoice[] = [
  { id: 'i1', number: 'INV-000010', customerId: 'c1', date: '2026-08-20', dueDate: '2026-09-19', total: 17700, paid: 5310, status: 'partially_paid' },
  { id: 'i2', number: 'INV-000011', customerId: 'c2', date: '2026-08-18', dueDate: '2026-08-23', total: 42500, paid: 0, status: 'overdue' },
  { id: 'i3', number: 'INV-000012', customerId: 'c3', date: '2026-08-15', dueDate: '2026-09-14', total: 28320, paid: 28320, status: 'paid' },
];

const seedEstimates: DemoEstimate[] = [
  { id: 'e1', number: 'EST-000005', customerId: 'c1', date: '2026-08-21', validUntil: '2026-09-05', total: 56640, status: 'sent' },
  { id: 'e2', number: 'EST-000006', customerId: 'c2', date: '2026-08-19', validUntil: '2026-09-03', total: 17700, status: 'accepted' },
];

const read = <T,>(key: string, fallback: T): T => { if (typeof window === 'undefined') return fallback; try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };
const write = <T,>(key: string, value: T) => { if (typeof window !== 'undefined') localStorage.setItem(key, JSON.stringify(value)); };

export const getDemoInvoices = () => read<DemoInvoice[]>('mm.demo.invoices', seedInvoices);
export const setDemoInvoices = (value: DemoInvoice[]) => write('mm.demo.invoices', value);
export const getDemoEstimates = () => read<DemoEstimate[]>('mm.demo.estimates', seedEstimates);
export const setDemoEstimates = (value: DemoEstimate[]) => write('mm.demo.estimates', value);
export const getDemoReceipts = () => read<DemoReceipt[]>('mm.demo.receipts', []);
export const setDemoReceipts = (value: DemoReceipt[]) => write('mm.demo.receipts', value);
export const getDemoCustomer = (id: string) => demoCustomers.find(c => c.id === id) || demoCustomers[0];
export const money = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => { const d = new Date(`${date}T00:00:00`); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
