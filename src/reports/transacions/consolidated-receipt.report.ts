import type {
  Content,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';
import * as path from 'path';
import { footerSection } from './sections/footer.section';
import { TransactionReceiptData } from './interfaces/transaction-receipt-data.interface';

export const consolidatedReceiptReport = (options: {
  data: TransactionReceiptData[];
}): TDocumentDefinitions => {
  const { data: dataArray } = options;

  if (dataArray.length === 0) {
    throw new Error('No hay recibos para consolidar');
  }

  const firstData = dataArray[0];
  const payerName = firstData.payerName;
  const uniqueBeneficiaries = new Set(dataArray.map((d) => d.beneficiaryId).filter(Boolean));
  let beneficiaryName = 'No especificado';
  if (uniqueBeneficiaries.size === 1) {
    beneficiaryName = dataArray.find((d) => d.beneficiaryId)?.beneficiaryName || 'No especificado';
  } else if (uniqueBeneficiaries.size > 1) {
    beneficiaryName = 'Varios';
  }
  const printDate = new Date().toLocaleDateString('es-BO');

  const buildHeaderBlock = (): Content => {
    let title = firstData.type === 'EXPENSE' ? 'COMPROB. EGRESO' : 'APORTE VOLUNTARIO';

    return {
      columns: [
        {
          width: 30,
          image: path.join(process.cwd(), 'dist', 'assets', 'logo-can.png'),
          margin: [0, 0, 5, 0],
        },
        {
          width: 90,
          stack: [
            { text: 'CLUB ATLÉTICO NACIONAL', bold: true, fontSize: 5 },
            { text: 'FUNDADO EL 17 DE OCTUBRE DE 1935', fontSize: 3.5, margin: [0, 1, 0, 1] },
            { text: 'DIR: 6 de octubre y Rodriguez\n(Parque de la Unión Nacional)\nORURO - BOLIVIA', fontSize: 3.5, lineHeight: 1.1 },
          ],
          margin: [0, 2, 0, 0],
        },
        {
          width: '*',
          stack: [
            { text: title, bold: true, fontSize: 7, alignment: 'right', margin: [0, 0, 0, 3] },
            {
              text: [ { text: 'PAGADOR: ', bold: true, fontSize: 5 }, { text: payerName, fontSize: 5 } ],
              alignment: 'right', margin: [0, 0, 0, 1],
            },
            {
              text: [ { text: 'BENEFICIARIO: ', bold: true, fontSize: 5 }, { text: beneficiaryName, fontSize: 5 } ],
              alignment: 'right', margin: [0, 0, 0, 1],
            },
            {
              text: [ { text: 'FECHA: ', bold: true, fontSize: 5 }, { text: printDate, fontSize: 5 } ],
              alignment: 'right',
            },
          ],
        },
      ],
      margin: [0, 0, 0, 5],
    };
  };

  const totalAmount = dataArray.reduce((sum, current) => sum + parseFloat(current.amountNumeric), 0);

  const buildTableBody = (): any[][] => {
    const tableBody: any[][] = [
      [
        { text: 'Fecha', bold: true, fontSize: 6 },
        { text: 'N° Recibo', bold: true, fontSize: 6 },
        { text: 'Beneficiario', bold: true, fontSize: 6 },
        { text: 'Concepto', bold: true, fontSize: 6 },
        { text: 'Monto (Bs)', bold: true, fontSize: 6, alignment: 'right' },
      ],
    ];

    dataArray.forEach((tx) => {
      tableBody.push([
        { text: tx.date.toLocaleDateString('es-BO'), fontSize: 6 },
        { text: `${tx.receiptSeries}-${tx.receiptNumber.split('/')[0].padStart(7, '0')}`, fontSize: 6 },
        { text: tx.beneficiaryName || 'No especificado', fontSize: 6 },
        { 
          stack: [
            { text: tx.concept, fontSize: 6 },
            { text: tx.paymentMethod, fontSize: 5, color: '#444444', margin: [0, 2, 0, 0] }
          ] 
        },
        { text: parseFloat(tx.amountNumeric).toFixed(2), fontSize: 6, alignment: 'right' },
      ]);
    });

    return tableBody;
  };

  const buildSignaturesBlock = (): Content => {
    return {
      columns: [
        {
          width: 80,
          stack: [
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 80, y2: 0, lineWidth: 1 }] },
            { text: 'ENTREGUÉ CONFORME', fontSize: 5, bold: true, alignment: 'center', margin: [0, 2, 0, 0] },
            { text: firstData.type === 'EXPENSE' ? firstData.receiverName : payerName, fontSize: 4, alignment: 'center' },
            { text: `C.I. ${firstData.type === 'EXPENSE' ? firstData.receiverDocument : firstData.payerDocument}`, fontSize: 4, alignment: 'center' },
          ],
        },
        { width: '*', text: '' },
        {
          width: 80,
          stack: [
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 80, y2: 0, lineWidth: 1 }] },
            { text: 'RECIBÍ CONFORME', fontSize: 5, bold: true, alignment: 'center', margin: [0, 2, 0, 0] },
            { text: firstData.type === 'EXPENSE' ? payerName : firstData.receiverName, fontSize: 4, alignment: 'center' },
            { text: `C.I. ${firstData.type === 'EXPENSE' ? firstData.payerDocument : firstData.receiverDocument}`, fontSize: 4, alignment: 'center' },
          ],
        },
      ],
      margin: [20, 5, 20, 0],
    };
  };

  const buildCopyStack = (isCopy: boolean): Content[] => {
    return [
      buildHeaderBlock(),
      {
        text: isCopy ? 'Copia: Secretaría' : 'Copia: Cliente',
        fontSize: 5,
        color: '#666666',
        alignment: 'right',
        margin: [0, -5, 0, 5],
      },
      {
        table: {
          headerRows: 1,
          widths: ['auto', 'auto', 'auto', '*', 'auto'],
          body: buildTableBody(),
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 10],
      },
      {
        text: [
          { text: 'TOTAL GENERAL: ', bold: true, fontSize: 7 },
          { text: `${totalAmount.toFixed(2)} Bs.`, bold: true, fontSize: 8 }
        ],
        alignment: 'right',
        margin: [0, 0, 0, 10]
      }
    ];
  };

  return {
    pageSize: { width: 612, height: 396 },
    pageMargins: [15, 15, 15, 55],
    background: function (currentPage, pageSize) {
      return [
        {
          canvas: [
            {
              type: 'line',
              x1: 306,
              y1: 15,
              x2: 306,
              y2: 381,
              lineWidth: 0.5,
              dash: { length: 5, space: 5 },
              lineColor: '#999999'
            }
          ]
        },
        {
          image: path.join(process.cwd(), 'dist', 'assets', 'logo-can-negro.png'),
          width: 140,
          opacity: 0.1,
          absolutePosition: { x: 75, y: 130 },
        },
        {
          image: path.join(process.cwd(), 'dist', 'assets', 'logo-can-negro.png'),
          width: 140,
          opacity: 0.1,
          absolutePosition: { x: 376, y: 130 },
        }
      ] as Content[];
    },
    footer: function (currentPage, pageCount) {
      if (currentPage === pageCount) {
        return {
          columns: [
            {
              width: 281,
              stack: [
                buildSignaturesBlock(),
                { stack: [footerSection()], margin: [0, 10, 0, 0] }
              ]
            },
            {
              width: 281,
              stack: [
                buildSignaturesBlock(),
                { stack: [footerSection()], margin: [0, 10, 0, 0] }
              ]
            }
          ],
          columnGap: 20,
          margin: [15, 0, 15, 0]
        };
      }
      return null;
    },
    content: [
      {
        columns: [
          {
            width: 281, // (612 - 30 margins - 20 gap) / 2 = 281
            stack: buildCopyStack(false)
          },
          {
            width: 281,
            stack: buildCopyStack(true)
          }
        ],
        columnGap: 20
      }
    ],
    defaultStyle: {
      fontSize: 6
    }
  };
};
