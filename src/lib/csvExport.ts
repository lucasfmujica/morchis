type TxRow = {
  id: string;
  amount: number;
  type: string;
  category_id: string | null;
  account_id: string | null;
  scope: string;
  is_shared: boolean;
  merchant: string | null;
  occurred_on: string;
  profile_id: string;
  categories: { name: string; icon: string } | null;
};

export function exportTransactionsToCSV(transactions: TxRow[], filename: string): void {
  const header = ['Fecha', 'Tipo', 'Categoría', 'Comercio', 'Monto ARS', 'Alcance', 'Compartido'];

  const rows = transactions.map((tx) => [
    tx.occurred_on,
    tx.type === 'expense' ? 'Gasto' : 'Ingreso',
    tx.categories?.name ?? '',
    tx.merchant ?? '',
    String(tx.amount),
    tx.scope === 'household' ? 'Hogar' : 'Personal',
    tx.is_shared ? 'Sí' : 'No',
  ]);

  const csv = [header, ...rows]
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell);
          return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"`
            : s;
        })
        .join(','),
    )
    .join('\n');

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
