import * as path from 'path';
import type { Content, Column } from 'pdfmake/interfaces';

interface HeaderOptions {
  receiptSeries: string;
  receiptNumber: string;
  date: Date;
  type?: 'INCOME' | 'EXPENSE';
  isPartialPayment?: boolean;
}

export const headerSection = (options: HeaderOptions): Content => {
  const { receiptSeries, receiptNumber, date, type, isPartialPayment } = options;
  let title = type === 'EXPENSE' ? 'COMPROBANTE DE EGRESO' : 'APORTE VOLUNTARIO';

  if (isPartialPayment) {
    title = type === 'EXPENSE' ? 'COMPROBANTE DE EGRESO (PARCIAL)' : 'APORTE VOLUNTARIO (PARCIAL)';
  }

  const logo: Content = {
    image: path.join(process.cwd(), 'dist', 'assets', 'logo-can.png'),
    width: 35, // reducido
    margin: [0, 0, 10, 0],
  };

  const clubInfo: Content = {
    stack: [
      { text: 'CLUB ATLÉTICO NACIONAL', bold: true, fontSize: 8 }, // reducido
      {
        text: 'FUNDADO EL 17 DE OCTUBRE DE 1935',
        fontSize: 5, // reducido
        margin: [0, 2, 0, 1],
      },
      {
        text: 'DIR: 6 de octubre y Rodriguez\n(Parque de la Unión Nacional)\nORURO - BOLIVIA',
        fontSize: 5, // reducido
        lineHeight: 1.1,
      },
    ],
    margin: [10, 5, 0, 0],
  };

  const receiptInfo: Content = {
    stack: [
      {
        text: title,
        bold: true,
        fontSize: 10, // reducido
        alignment: 'right',
        margin: [0, 0, 30, 3],
      },
      {
        columns: [
          {
            stack: [
              {
                text: 'No.:',
                fontSize: 6, // reducido
                bold: true,
                alignment: 'center',
                margin: [0, 0, 0, 2],
              },
              {
                stack: [
                  {
                    canvas: [
                      {
                        type: 'rect',
                        x: 0,
                        y: 0,
                        w: 75, // reducido
                        h: 12, // reducido
                        r: 4,
                        lineWidth: 0.5,
                      },
                    ],
                  },
                  {
                    text: `${receiptSeries}-${receiptNumber}`,
                    alignment: 'center',
                    fontSize: 7, // reducido
                    margin: [0, -9.5, 0, 0], // ajustado para h=12
                  },
                ],
              },
            ],
            width: 'auto',
            margin: [0, 0, 5, 0],
          },
          {
            stack: [
              {
                text: 'FECHA DE EMISIÓN:',
                fontSize: 6, // reducido
                bold: true,
                alignment: 'center',
                margin: [0, 0, 0, 2],
              },
              {
                stack: [
                  {
                    canvas: [
                      {
                        type: 'rect',
                        x: 0,
                        y: 0,
                        w: 75, // reducido
                        h: 12, // reducido
                        r: 4,
                        lineWidth: 0.5,
                      },
                    ],
                  },
                  {
                    text: date.toLocaleDateString('es-BO'),
                    alignment: 'center',
                    fontSize: 7, // reducido
                    margin: [0, -9.5, 0, 0], // ajustado para h=12
                  },
                ],
              },
            ],
            width: 'auto',
          },
        ],
        alignment: 'right',
        margin: [0, 0, 30, 5],
      },
    ],
  };

  return {
    columns: [
      {
        width: 45, // reducido
        ...logo,
      },
      {
        width: '*',
        ...clubInfo,
      },
      {
        width: 150, // reducido
        ...receiptInfo,
      },
    ],
    margin: [20, 10, 25, 5], // márgenes reducidos
  };
};
