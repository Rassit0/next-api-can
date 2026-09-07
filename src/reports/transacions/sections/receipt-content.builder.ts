import type { Content } from 'pdfmake/interfaces';
import * as path from 'path';
import { headerSection } from './header.section';
import { footerSection } from './footer.section';
import { TransactionReceiptData } from '../interfaces/transaction-receipt-data.interface';

export const buildReceiptContent = (
  startY: number,
  data: TransactionReceiptData,
): Content[] => {
  return [
    // 1. HEADER
    {
      absolutePosition: { x: 20, y: startY - 5 },
      columns: [
        {
          width: 356,
          stack: [
            headerSection({
              receiptSeries: data.receiptSeries,
              receiptNumber: data.receiptNumber,
              date: data.date,
              type: data.type,
              isPartialPayment: data.isPartialPayment,
            }),
          ],
        },
      ],
    },
    // 2. Fondo Gris del Medio
    {
      canvas: [
        {
          type: 'rect',
          x: 0,
          y: 0,
          w: 226,
          h: data.beneficiaryName ? 130 : 110,
          r: 4,
          color: '#EBEBEB',
        },
      ],
      absolutePosition: { x: 30, y: startY + 65 },
    },
    // 3. Marca de agua
    {
      image: path.join(process.cwd(), 'dist', 'assets', 'logo-can-negro.png'),
      width: 160,
      opacity: 0.1,
      absolutePosition: { x: 180, y: startY + 30 },
    },
    // 4. CONTENT (Textos)
    {
      absolutePosition: { x: 20, y: startY + 65 },
      columns: [
        {
          width: 356,
          stack: [
            {
              table: {
                widths: ['*', 110], // Reducido col derecha
                body: [
                  [
                    // Columna Izquierda: Descripción
                    {
                      stack: [
                        {
                          text: 'DESCRIPCIÓN',
                          bold: true,
                          fontSize: 9,
                          margin: [0, 0, 0, 6],
                        },
                        { text: data.type === 'EXPENSE' ? 'Pagado a:' : 'Recibí de:', fontSize: 7, bold: true },
                        {
                          text: data.payerName,
                          fontSize: 8,
                          margin: [0, 0, 0, 5],
                        },
                        ...(data.beneficiaryName
                          ? ([
                              {
                                text: data.type === 'EXPENSE' ? 'Concepto detallado (Alumno/Jugador):' : 'A favor de (Alumno/Jugador):',
                                fontSize: 7,
                                bold: true,
                              },
                              {
                                text: data.beneficiaryName,
                                fontSize: 8,
                                margin: [0, 0, 0, 5],
                              },
                            ] as Content[])
                          : []),
                        { text: 'La suma de:', fontSize: 7, bold: true },
                        {
                          text: data.amountLiteral,
                          fontSize: 8,
                          margin: [0, 0, 0, 5],
                        },
                        { text: 'Por concepto de:', fontSize: 7, bold: true },
                        { text: data.concept, fontSize: 8 },
                      ],
                      margin: [10, 8, 10, 8] as [
                        number,
                        number,
                        number,
                        number,
                      ],
                      border: [false, false, false, false],
                    },
                    // Columna Derecha: Monto y Forma de Pago
                    {
                      stack: [
                        {
                          text: 'MONTO:',
                          bold: true,
                          fontSize: 9,
                          alignment: 'right',
                          margin: [0, 0, 0, 3],
                        },
                        {
                          stack: [
                            {
                              canvas: [
                                {
                                  type: 'rect',
                                  x: 20,
                                  y: 0,
                                  w: 80,
                                  h: 18,
                                  r: 4,
                                  lineWidth: 0.5,
                                },
                              ],
                            },
                            {
                              text: `${data.amountNumeric} Bs.`,
                              alignment: 'right',
                              fontSize: 10,
                              bold: true,
                              margin: [0, -13.5, 10, 0],
                            },
                          ],
                          margin: [0, 0, 0, 15],
                        },
                        {
                          text: 'FORMA DE PAGO:',
                          fontSize: 7,
                          bold: true,
                          alignment: 'right',
                        },
                        {
                          text: data.paymentMethod,
                          fontSize: 8,
                          bold: true,
                          alignment: 'right',
                        },
                        {
                          qr: data.validationUrl,
                          fit: 60,
                          alignment: 'right',
                          margin: [0, 8, 5, 0],
                        },
                      ],
                      margin: [10, 8, 10, 8],
                      border: [false, false, false, false],
                    },
                  ],
                ],
              },
              layout: 'noBorders',
              margin: [20, 0, 20, 5],
            },
            // 5. FIRMAS
            {
              columns: [
                {
                  width: 100, // reducido
                  stack: [
                    {
                      canvas: [
                        {
                          type: 'line',
                          x1: 0,
                          y1: 0,
                          x2: 100,
                          y2: 0,
                          lineWidth: 1,
                        },
                      ],
                    },
                    {
                      text: 'ENTREGUÉ CONFORME',
                      fontSize: 6,
                      bold: true,
                      alignment: 'center',
                      margin: [0, 2, 0, 0],
                    },
                    {
                      text: data.type === 'EXPENSE' ? data.receiverName : data.payerName,
                      fontSize: 5,
                      alignment: 'center',
                    },
                    {
                      text: `C.I. ${data.type === 'EXPENSE' ? data.receiverDocument : data.payerDocument}`,
                      fontSize: 5,
                      alignment: 'center',
                    },
                  ],
                },
                { width: '*', text: '' },
                {
                  width: 100, // reducido
                  stack: [
                    {
                      canvas: [
                        {
                          type: 'line',
                          x1: 0,
                          y1: 0,
                          x2: 100,
                          y2: 0,
                          lineWidth: 1,
                        },
                      ],
                    },
                    {
                      text: 'RECIBÍ CONFORME',
                      fontSize: 6,
                      bold: true,
                      alignment: 'center',
                      margin: [0, 2, 0, 0],
                    },
                    {
                      text: data.type === 'EXPENSE' ? data.payerName : data.receiverName,
                      fontSize: 5,
                      alignment: 'center',
                    },
                    {
                      text: `C.I. ${data.type === 'EXPENSE' ? data.payerDocument : data.receiverDocument}`,
                      fontSize: 5,
                      alignment: 'center',
                    },
                  ],
                },
              ],
              margin: [30, 10, 30, 0], // Compensación por haber bajado el bloque de contenido
            },
          ],
        },
      ],
    },
    // 6. FOOTER
    {
      absolutePosition: { x: 20, y: startY + 244 },
      columns: [
        {
          width: 356,
          stack: [footerSection()],
        },
      ],
    },
  ];
};
