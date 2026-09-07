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

interface ReportOptions {
  data: TransactionReceiptData;
  isSingle?: boolean;
}

export const transactionByIdReport = (
  options: ReportOptions,
): TDocumentDefinitions => {
  const { data, isSingle = false } = options;

  
  if (!isSingle) {
    // Hoja vertical (13.97 x 21.59 cm) -> 396 x 612 puntos
    // Un recibo arriba y uno abajo
    return {
      pageSize: { width: 396, height: 612 },
      pageMargins: [0, 0, 0, 0],

      background: [
        {
          canvas: [
            // RECIBO 1 (Arriba) startY = 20
            {
              type: 'rect',
              x: 21,
              y: 20 + 242,
              w: 354,
              h: 17,
              r: 4,
              color: '#EBEBEB',
            },
            {
              type: 'rect',
              x: 20,
              y: 20,
              w: 356,
              h: 260,
              r: 5,
              lineWidth: 1,
              lineColor: '#000000',
            },

            // RECIBO 2 (Abajo) startY = 326
            {
              type: 'rect',
              x: 21,
              y: 326 + 242,
              w: 354,
              h: 17,
              r: 4,
              color: '#EBEBEB',
            },
            {
              type: 'rect',
              x: 20,
              y: 326,
              w: 356,
              h: 260,
              r: 5,
              lineWidth: 1,
              lineColor: '#000000',
            },

            // Línea punteada divisoria horizontal en el medio de la hoja
            {
              type: 'line',
              x1: 0,
              y1: 306,
              x2: 396,
              y2: 306,
              lineWidth: 0.5,
              dash: { length: 5, space: 5 },
              lineColor: '#999999',
            },
          ],
        },
      ],

      content: [...buildReceiptContent(20, data), ...buildReceiptContent(326, data)],
    };
  } else {
    // Modo único (1 recibo) para descargar digitalmente
    return {
      pageSize: { width: 396, height: 306 },
      pageMargins: [0, 0, 0, 0],

      background: [
        {
          canvas: [
            {
              type: 'rect',
              x: 21,
              y: 23 + 242,
              w: 354,
              h: 17,
              r: 4,
              color: '#EBEBEB',
            },
            {
              type: 'rect',
              x: 20,
              y: 23,
              w: 356,
              h: 260,
              r: 5,
              lineWidth: 1,
              lineColor: '#000000',
            },
          ],
        },
      ],

      content: [...buildReceiptContent(23, data)],
    };
  }
};
