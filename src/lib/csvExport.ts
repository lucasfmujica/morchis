type TxRow = {
  id: string;
  amount: number;
  type: string;
  currency?: string | null;
  category_id: string | null;
  account_id: string | null;
  scope: string;
  is_shared: boolean;
  merchant: string | null;
  occurred_on: string;
  profile_id: string;
  categories: { name: string; icon: string } | null;
};

const TYPE_LABEL: Record<string, string> = {
  expense: 'Gasto',
  income: 'Ingreso',
  transfer: 'Transferencia',
};

export function exportTransactionsToCSV(transactions: TxRow[], filename: string): void {
  // Amount is exported in each row's own currency, with an explicit Moneda
  // column, so a USD movement isn't mislabelled as pesos.
  const header = ['Fecha', 'Tipo', 'Categoría', 'Comercio', 'Monto', 'Moneda', 'Alcance', 'Compartido'];

  const rows = transactions.map((tx) => [
    tx.occurred_on,
    TYPE_LABEL[tx.type] ?? tx.type,
    tx.categories?.name ?? '',
    tx.merchant ?? '',
    String(tx.amount),
    tx.currency ?? 'ARS',
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
