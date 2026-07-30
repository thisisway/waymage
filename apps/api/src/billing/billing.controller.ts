import { Controller, Get } from '@nestjs/common';
import { Principal, type RequestPrincipal } from '../auth/request-user';
import { BillingService, type TransactionView, type UsageView } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('wallet')
  wallet(@Principal() principal: RequestPrincipal) {
    return this.billing.wallet(principal);
  }

  @Get('transactions')
  transactions(@Principal() principal: RequestPrincipal): Promise<TransactionView[]> {
    return this.billing.transactions(principal);
  }

  @Get('usage')
  usage(@Principal() principal: RequestPrincipal): Promise<UsageView[]> {
    return this.billing.usage(principal);
  }

  /**
   * Conferência de integridade do ledger.
   *
   * Exposta de propósito: se a soma do extrato divergir do saldo, alguém precisa conseguir
   * ver isso sem acesso ao banco.
   */
  @Get('reconcile')
  reconcile(@Principal() principal: RequestPrincipal) {
    return this.billing.reconcile(principal);
  }
}
