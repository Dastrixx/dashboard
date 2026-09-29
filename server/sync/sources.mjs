// Sources used by the owner, sales, team, warehouse and purchasing routes.
// A source is marked complete only after every page has been read.
export const DATED_SOURCES = [
  { entity: 'Document_ЧекККМ', field: 'Date' },
  { entity: 'Document_КассоваяСмена', field: 'Date' },
  { entity: 'Document_ПоступлениеТоваров', field: 'Date' },
  { entity: 'Document_СписаниеТоваров', field: 'Date' },
  { entity: 'Document_ПересчетТоваров', field: 'Date' },
  { entity: 'Document_РеализацияТоваров', field: 'Date' },
  { entity: 'Document_ПеремещениеТоваров', field: 'Date' },
  { entity: 'Document_ЗаказНаПеремещение', field: 'Date' },
  { entity: 'Document_ЗаказПоставщику', field: 'Date' },
  { entity: 'Document_ВозвратТоваровОтПокупателя', field: 'Date' },
  { entity: 'Document_ВозвратТоваровПоставщику', field: 'Date' },
  { entity: 'AccumulationRegister_Продажи_RecordType', field: 'Period' },
  { entity: 'AccumulationRegister_ПремииПоЛичнымПродажам_RecordType', field: 'Period' },
  { entity: 'AccumulationRegister_ТоварыНаСкладах_RecordType', field: 'Period' },
  { entity: 'InformationRegister_СебестоимостьНоменклатуры_RecordType', field: 'Period' },
  { entity: 'InformationRegister_ЦеныНоменклатуры_RecordType', field: 'Period' },
  { entity: 'InformationRegister_ДействующиеЦеныНоменклатуры_RecordType', field: 'Period' },
];

export const CATALOG_SOURCES = [
  'Catalog_Номенклатура',
  'Catalog_ВидыНоменклатуры',
  'Catalog_ТоварныеГруппы',
  'Catalog_ФизическиеЛица',
  'Catalog_Магазины',
  'Catalog_Пользователи',
  'Catalog_Склады',
  'Catalog_Контрагенты',
  'Catalog_ВидыОплатЧекаККМ',
];

export const SNAPSHOT_SOURCES = ['Balance_ТоварыНаСкладах', 'SliceLast_СебестоимостьНоменклатуры'];
export const datedType = entity => `raw:${entity}`;
export const snapshotType = entity => `raw:${entity}`;
export const RAW_TYPES = [
  ...DATED_SOURCES.map(({ entity }) => datedType(entity)),
  ...CATALOG_SOURCES.map(datedType),
  ...SNAPSHOT_SOURCES.map(snapshotType),
];
