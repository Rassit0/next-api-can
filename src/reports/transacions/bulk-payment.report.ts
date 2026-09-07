import type {
  Content,
  TDocumentDefinitions,
  PageSize,
} from 'pdfmake/interfaces';
import { buildReceiptContent } from './sections/receipt-content.builder';
import { headerSection } from './sections/header.section';
import { footerSection } from './sections/footer.section';
import * as path from 'path';
import { TransactionReceiptData } from './interfaces/transaction-receipt-data.interface';

export const bulkPaymentReport = (
  options: { data: TransactionReceiptData[] },
): TDocumentDefinitions => {
  const { data: dataArray } = options;

  
  const background: any[] = [];
  const content: any[] = [];
  
  for (let i = 0; i < dataArray.length; i++) {
    const data = dataArray[i];
    const isEven = i % 2 === 0;
    const startY = isEven ? 20 : 326;
    
    background.push(
      {
        canvas: [
          {
            type: 'rect',
            x: 21,
            y: startY + 242,
            w: 354,
            h: 17,
            r: 4,
            color: '#EBEBEB',
          },
          {
            type: 'rect',
            x: 20,
            y: startY,
            w: 356,
            h: 260,
            r: 5,
            lineWidth: 1,
            lineColor: '#000000',
          },
          ...(isEven ? [{
            type: 'line',
            x1: 0,
            y1: 306,
            x2: 396,
            y2: 306,
            lineWidth: 0.5,
            dash: { length: 5, space: 5 },
            lineColor: '#999999',
          }] : [])
        ]
      }
    );

    const receiptContent = buildReceiptContent(startY, data);
    
    if (!isEven && i < dataArray.length - 1) {
      (receiptContent[receiptContent.length - 1] as any).pageBreak = 'after';
    }
    
    content.push(...receiptContent);
  }

  const totalAmount = dataArray.reduce((acc, item) => acc + parseFloat(item.amountNumeric), 0);
  
  const summaryContent: any[] = [
    { text: '', pageBreak: 'before' },
    { text: 'CONSOLIDADO DE PAGOS', fontSize: 14, bold: true, alignment: 'center', margin: [0, 20, 0, 20] },
    {
      table: {
        headerRows: 1,
        widths: ['auto', '*', 'auto', 'auto'],
        body: [
          [
            { text: 'Nº RECIBO', bold: true },
            { text: 'CONCEPTO', bold: true },
            { text: 'MÉTODO', bold: true },
            { text: 'MONTO (Bs)', bold: true, alignment: 'right' }
          ],
          ...dataArray.map(item => {
             const method = item.paymentMethod.split('\n').map(m => m.split(':')[0]).join(', ');
             return [
               item.receiptNumber,
               item.concept,
               method,
               { text: item.amountNumeric, alignment: 'right' }
             ];
          }),
          [
            { text: 'TOTAL GENERAL', bold: true, colSpan: 3, alignment: 'right' },
            {},
            {},
            { text: totalAmount.toFixed(2), bold: true, alignment: 'right' }
          ]
        ]
      },
      layout: 'lightHorizontalLines',
      margin: [20, 0, 20, 0]
    }
  ];
  
  content.push(...summaryContent);

  return {
    pageSize: { width: 396, height: 612 },
    pageMargins: [0, 0, 0, 0],
    background: background,
    content: content,
  };
};
