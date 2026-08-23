export type DemoCustomer = { id: string; name: string; email: string; phone: string };
export type DemoItem = { id: string; name: string; price: number; tax: number };
export type DemoInvoice = { id: string; number: string; customerId: string; date: string; dueDate: string; total: number; paid: number; status: 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue'; sourceEstimateId?: string };
export type DemoEstimate = { id: string; number: string; customerId: string; date: string; validUntil: string; total: number; status: 'draft' | 'sent' | 'accepted' | 'converted' };

export const demoBusiness = { id: 'demo-business', name: 'Moneymatters Demo Business', role: 'Owner' };
export const demoCustomers: DemoCustomer[] = [
  { id: 'c1', name: 'Rahul Sharma', email: 'rahul@example.com', phone: '+91 98765 43210' },
  { id: 'c2', name: 'ABC Enterprises', email: 'accounts@abcenterprises.example', phone: '+91 98220 11223' },
  { id: 'c3', name: 'Mehta Electricals', email: 'office@mehtaelectricals.example', phone: '+91 97655 44556' },
];
export const demoItems: DemoItem[] = [
  { id: 'p1', name: 'Professional Service', price: 2500, tax: 18 },
  { id: 'p2', name: 'AC Installation', price: 5000, tax: 18 },
  { id: 'p3', name: 'Annual Maintenance Contract', price: 12000, tax: 18 },
  { id: 'p4', name: 'Consulting Session', price: 3000, tax: 18 },
];

const initialInvoices: DemoInvoice[] = [
  { id: 'i1', number: 'INV-000009', customerId: 'c1', date: '2026-08-22', dueDate: '2026-09-21', total: 7080, paid: 5900, status: 'partially_paid' },
  { id: 'i2', number: 'INV-000008', customerId: 'c2', date: '2026-08-18', dueDate: '2026-08-20', total: 42500, paid: 0, status: 'overdue' },
  { id: 'i3', number: 'INV-000007', customerId: 'c3', date: '2026-08-15', dueDate: '2026-09-14', total: 23600, paid: 23600, status: 'paid' },
];
const initialEstimates: DemoEstimate[] = [
  { id: 'e1', number: 'EST-000004', customerId: 'c1', date: '2026-08-22', validUntil: '2026-09-21', total: 17700, status: 'accepted' },
  { id: 'e2', number: 'EST-000003', customerId: 'c2', date: '2026-08-20', validUntil: '2026-09-03', total: 59000, status: 'sent' },
];

const read = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try { const value = window.localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
};
const write = (key: string, value: unknown) => { if (typeof window !== 'undefined') window.localStorage.setItem(key, JSON.stringify(value)); };

export const getDemoInvoices = () => read('mm.demo.invoices', initialInvoices);
export const setDemoInvoices = (value: DemoInvoice[]) => write('mm.demo.invoices', value);
export const getDemoEstimates = () => read('mm.demo.estimates', initialEstimates);
export const setDemoEstimates = (value: DemoEstimate[]) => write('mm.demo.estimates', value);
export const getDemoCustomers = () => read('mm.demo.customers', demoCustomers);
export const getDemoCustomer = (id: string) => getDemoCustomers().find(c => c.id === id) || demoCustomers[0];
export const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
