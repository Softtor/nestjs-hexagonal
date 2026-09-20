export interface InvoiceTemplatingPort {
  render(
    templateId: string,
    variables: Readonly<Record<string, string>>,
  ): Promise<string>;

  listAvailableTemplates(): Promise<{ templateId: string; label: string }[]>;
}

export const INVOICE_TEMPLATING_PORT = Symbol('InvoiceTemplatingPort');
