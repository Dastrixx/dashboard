export type Period = 7 | 30 | 90;

export type OnecLine = {
  LineNumber: string;
  Номенклатура_Key: string;
  Количество: number;
  Цена: number;
  Сумма: number;
  Склад_Key: string;
  Продавец_Key: string;
};

export type OnecReport = {
  Ref_Key: string;
  Number: string;
  Date: string;
  Posted: boolean;
  СуммаДокумента: number;
  СуммаВозвратов: number;
  Магазин_Key: string;
  Товары: OnecLine[];
};

export type OnecPayload = {
  items?: OnecReport[];
  message?: string;
};

export type StockBalance = {
  Склад_Key: string;
  Номенклатура_Key: string;
  КоличествоBalance: number;
  РезервBalance: number;
  ор_СебестоимостьBalance?: number;
};

export type StockReference = {
  Ref_Key: string;
  Code?: string;
  Description?: string;
  НаименованиеПолное?: string;
  Артикул?: string;
  ВидНоменклатуры_Key?: string;
  ВидНоменклатуры?: string | null;
  BusinessCategory_Key?: string | null;
  BusinessCategory?: string | null;
  ТипСклада?: string;
};

export type StockOperationLine = {
  LineNumber?: string | number;
  Номенклатура_Key: string;
  Количество?: number;
  КоличествоФакт?: number;
  Сумма?: number;
  СуммаФакт?: number;
};

export type StockOperation = {
  Ref_Key: string;
  Number?: string;
  Date: string;
  Posted?: boolean;
  Склад_Key?: string;
  Контрагент_Key?: string;
  СуммаДокумента?: number;
  ОснованиеСписания?: string;
  Комментарий?: string;
  Статус?: string;
  Товары?: StockOperationLine[];
};

export type StockPayload = {
  items?: StockBalance[];
  references?: {
    products?: StockReference[];
    warehouses?: StockReference[];
    categories?: StockReference[];
    suppliers?: StockReference[];
  };
  operations?: {
    receipts?: StockOperation[];
    writeOffs?: StockOperation[];
    recounts?: StockOperation[];
  };
  meta?: {
    loaded?: number;
    asOf?: string;
    requestedAt?: string;
    balancePeriod?: string;
    latestOperationDate?: string | null;
    operationFreshness?: {
      status: "fresh" | "stale" | "future" | "unknown";
      ageHours: number | null;
      maxAgeHours: number | null;
    };
    source?: string;
    operationErrors?: Record<string, string>;
  };
  message?: string;
};

export type SellerTurnover = {
  Продавец_Key: string;
  Магазин_Key: string;
  КоличествоTurnover?: number;
  СтоимостьTurnover?: number;
  СтоимостьБезСкидокTurnover?: number;
  СтрокПродаж?: number;
  СтрокВозвратов?: number;
  Чеков?: number;
  ИдентификаторыЧеков?: string[];
  СуммаСкидок?: number;
  ПродажиПоДатам?: Record<string, number>;
};

export type SellerReference = {
  Ref_Key: string;
  Code?: string;
  Description?: string;
  Магазин_Key?: string;
};

export type SellerPayload = {
  items?: SellerTurnover[];
  references?: {
    sellers?: SellerReference[];
    stores?: SellerReference[];
  };
  meta?: {
    days?: number;
    loaded?: number;
    latestDate?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    scope?: "all" | "period";
    absoluteLatestDate?: string | null;
    analysisAnchorAdjusted?: boolean;
    ignoredIsolatedDocuments?: number;
    source?: string;
    diagnostics?: {
      turnoverRows?: number;
      turnoverRowsWithSeller?: number;
      scannedChecks?: number;
      loadedChecks?: number;
      scannedCashShifts?: number;
      loadedCashShifts?: number;
      checksWithAssignedEmployee?: number;
      scannedPremiumRows?: number;
      scannedRealizations?: number;
      resultRows?: number;
      reports?: number;
      salesLines?: number;
      returnLines?: number;
      linesWithConsultant?: number;
      consultants?: number;
      checkLines?: number;
      checkLinesWithConsultant?: number;
    };
  };
  message?: string;
};
