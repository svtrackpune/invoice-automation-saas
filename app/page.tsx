'use client';
import { useState } from "react";

export default function Dashboard() {
  const [notification, setNotification] = useState("");

  const stats = [
    { name: "Total Outstanding", value: "$12,450.00", change: "+4.75%", changeType: "positive" },
    { name: "Paid This Month", value: "$8,200.00", change: "+12.3%", changeType: "positive" },
    { name: "Pending Follow-ups", value: "5 Invoices", change: "Action Required", changeType: "neutral" },
  ];

  const recentInvoices = [
    { id: "INV-2026-001", client: "Acme Corp", amount: "$4,500.00", dueDate: "2026-08-15", status: "Pending" },
    { id: "INV-2026-002", client: "Stark Industries", amount: "$3,200.00", dueDate: "2026-08-10", status: "Paid" },
    { id: "INV-2026-003", client: "Wayne Enterprises", amount: "$4,750.00", dueDate: "2026-08-01", status: "Overdue" },
  ];

  const clients = [
    { name: "Acme Corp", contact: "John Smith", email: "john@acme.com", activeInvoices: 2, totalBilled: "$9,200.00" },
    { name: "Stark Industries", contact: "Pepper Potts", email: "pepper@stark.com", activeInvoices: 1, totalBilled: "$3,200.00" },
    { name: "Wayne Enterprises", contact: "Lucius Fox", email: "lucius@wayne.com", activeInvoices: 1, totalBilled: "$4,750.00" },
  ];

  const handleSendReminder = (clientName, invoiceId) => {
    setNotification(`Automated reminder successfully dispatched to ${clientName} for invoice ${invoiceId} via Email & WhatsApp API.`);
    setTimeout(() => setNotification(""), 6000);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Notification Banner */}
        {notification && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg shadow-sm flex items-center justify-between text-sm">
            <span>{notification}</span>
            <button onClick={() => setNotification("")} className="font-bold text-emerald-600 hover:text-emerald-800">×</button>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">Invoice Automation SaaS</h1>
            <p className="text-sm text-gray-500 mt-1">Manage clients, automate reminders, and track payments seamlessly.</p>
          </div>
          <button className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-lg shadow-sm transition">
            + Create New Invoice
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {stats.map((stat) => (
            <div key={stat.name} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <p className="text-sm font-medium text-gray-500">{stat.name}</p>
              <p className="text-3xl font-bold mt-2">{stat.value}</p>
              <span className="inline-block text-xs font-semibold mt-3 text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                {stat.change}
              </span>
            </div>
          ))}
        </div>

        {/* Recent Invoices Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex justify-between items-center">
            <h2 className="text-lg font-bold">Recent Invoices & Automated Follow-ups</h2>
            <span className="text-xs text-gray-500 font-medium">Click "Send Reminder" to trigger instant follow-up</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-6">Invoice ID</th>
                  <th className="py-3 px-6">Client</th>
                  <th className="py-3 px-6">Amount</th>
                  <th className="py-3 px-6">Due Date</th>
                  <th className="py-3 px-6">Status</th>
                  <th className="py-3 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {recentInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50/50 transition">
                    <td className="py-4 px-6 font-medium text-blue-600">{inv.id}</td>
                    <td className="py-4 px-6 font-medium">{inv.client}</td>
                    <td className="py-4 px-6">{inv.amount}</td>
                    <td className="py-4 px-6 text-gray-500">{inv.dueDate}</td>
                    <td className="py-4 px-6">
                      <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                        inv.status === "Paid" ? "bg-green-50 text-green-700" :
                        inv.status === "Pending" ? "bg-amber-50 text-amber-700" :
                        "bg-red-50 text-red-700"
                      }`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      {inv.status !== "Paid" ? (
                        <button 
                          onClick={() => handleSendReminder(inv.client, inv.id)}
                          className="text-xs font-semibold bg-gray-100 hover:bg-blue-50 text-gray-700 hover:text-blue-600 px-3 py-1.5 rounded transition border border-gray-200 hover:border-blue-200">
                          Send Reminder
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400 font-medium">Completed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Client Directory Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex justify-between items-center">
            <h2 className="text-lg font-bold">Client Directory</h2>
            <button className="text-sm font-medium text-blue-600 hover:text-blue-700">+ Add Client</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-6">Company Name</th>
                  <th className="py-3 px-6">Contact Person</th>
                  <th className="py-3 px-6">Email</th>
                  <th className="py-3 px-6">Active Invoices</th>
                  <th className="py-3 px-6">Total Billed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {clients.map((client) => (
                  <tr key={client.name} className="hover:bg-gray-50/50 transition">
                    <td className="py-4 px-6 font-medium text-gray-900">{client.name}</td>
                    <td className="py-4 px-6 text-gray-600">{client.contact}</td>
                    <td className="py-4 px-6 text-gray-500">{client.email}</td>
                    <td className="py-4 px-6">{client.activeInvoices}</td>
                    <td className="py-4 px-6 font-semibold">{client.totalBilled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
