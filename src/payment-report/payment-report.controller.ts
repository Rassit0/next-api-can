import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  Res,
  UseGuards,
} from '@nestjs/common';
import { PaymentReportService } from './payment-report.service';
import { GetBulkPaymentReportDto } from './dto/get-bulk-payment-report.dto';
import { PrinterService } from 'src/printer/printer.service';
import { PrismaService } from 'src/prisma.service';
import { Response } from 'express';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiParam, ApiProduces } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UserRoleGuard } from '../auth/guards/user-role/user-role.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@ApiTags('Payment Reports')
@Controller('payment-report')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), UserRoleGuard)
export class PaymentReportController {
  constructor(
    private readonly paymentReportService: PaymentReportService,
    private readonly printerService: PrinterService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('payment/:paymentId')
  @ApiOperation({ summary: 'Generar recibo de pago', description: 'Genera un PDF con el recibo consolidado del pago (formato estándar con 2 copias).' })
  @ApiParam({ name: 'paymentId', description: 'UUID del pago' })
  @ApiProduces('application/pdf')
  @RequirePermissions('READ_TRANSACTIONS', 'CREATE_TRANSACTIONS')
  async getPaymentReport(
    @Res() response: Response,
    @Param('paymentId') paymentId: string,
  ) {
    const pdfDoc =
      await this.paymentReportService.getPaymentByIdReport(
        paymentId,
        false // No es single (imprime la hoja con 2 copias a la izquierda)
      );

    response.setHeader('Content-Type', 'application/pdf');
    pdfDoc.info.Title = 'Payment-Report';
    pdfDoc.pipe(response);
    pdfDoc.end();
  }

  @Get('payment/:paymentId/single')
  @ApiOperation({ summary: 'Generar recibo de pago (Versión Móvil)', description: 'Genera un PDF con el recibo consolidado del pago en formato pequeño optimizado para compartir.' })
  @ApiParam({ name: 'paymentId', description: 'UUID del pago' })
  @ApiProduces('application/pdf')
  @RequirePermissions('READ_TRANSACTIONS', 'CREATE_TRANSACTIONS')
  async getSinglePaymentReport(
    @Res() response: Response,
    @Param('paymentId') paymentId: string,
  ) {
    const pdfDoc =
      await this.paymentReportService.getPaymentByIdReport(
        paymentId,
        true // Es single (imprime un PDF pequeño solo para mandar por WhatsApp)
      );

    response.setHeader('Content-Type', 'application/pdf');
    pdfDoc.info.Title = 'Payment-Report-Single';
    pdfDoc.pipe(response);
    pdfDoc.end();
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Generar recibo consolidado de múltiples pagos', description: 'Genera un PDF multipágina agrupando los recibos especificados y agregando un resumen final.' })
  @ApiProduces('application/pdf')
  @RequirePermissions('READ_TRANSACTIONS', 'CREATE_TRANSACTIONS')
  async getBulkPaymentReport(
    @Res() response: Response,
    @Body() dto: GetBulkPaymentReportDto,
  ) {
    const pdfDoc = await this.paymentReportService.getBulkPaymentReport(dto.paymentIds || []);

    response.setHeader('Content-Type', 'application/pdf');
    pdfDoc.info.Title = 'Consolidated-Payment-Report';
    pdfDoc.pipe(response);
    pdfDoc.end();
  }

  @Get('transaction/:transactionId')
  @ApiOperation({ summary: 'Generar recibo de transacción', description: 'Genera un PDF con el recibo consolidado de la transacción (formato estándar con 2 copias).' })
  @ApiParam({ name: 'transactionId', description: 'UUID de la transacción' })
  @ApiProduces('application/pdf')
  @RequirePermissions('READ_TRANSACTIONS', 'CREATE_TRANSACTIONS')
  async getTransactionReport(
    @Res() response: Response,
    @Param('transactionId') transactionId: string,
  ) {
    const pdfDoc =
      await this.paymentReportService.getTransactionByIdReport(
        transactionId,
        false // No es single
      );

    response.setHeader('Content-Type', 'application/pdf');
    pdfDoc.info.Title = 'Transaction-Report';
    pdfDoc.pipe(response);
    pdfDoc.end();
  }

  @Get('transaction/:transactionId/single')
  @ApiOperation({ summary: 'Generar recibo de transacción (Versión Móvil)', description: 'Genera un PDF con el recibo consolidado de la transacción en formato pequeño optimizado para compartir.' })
  @ApiParam({ name: 'transactionId', description: 'UUID de la transacción' })
  @ApiProduces('application/pdf')
  @RequirePermissions('READ_TRANSACTIONS', 'CREATE_TRANSACTIONS')
  async getSingleTransactionReport(
    @Res() response: Response,
    @Param('transactionId') transactionId: string,
  ) {
    const pdfDoc =
      await this.paymentReportService.getTransactionByIdReport(
        transactionId,
        true // Es single
      );

    response.setHeader('Content-Type', 'application/pdf');
    pdfDoc.info.Title = 'Transaction-Report-Single';
    pdfDoc.pipe(response);
    pdfDoc.end();
  }
}
