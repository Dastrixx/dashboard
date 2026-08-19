export const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

export const BUSINESS_CATEGORIES = [
  {
    Ref_Key: "home-textile",
    Description: "Домашний текстиль",
    aliases: ["домашний текстиль", "плед"],
  },
  {
    Ref_Key: "tableware",
    Description: "Посуда",
    aliases: ["посуда", "посуда китай"],
  },
  {
    Ref_Key: "clothing",
    Description: "Одежда",
    aliases: ["одежда"],
  },
  {
    Ref_Key: "household-chemicals",
    Description: "Бытовая химия",
    aliases: ["детская химия", "мыломойка", "бытовая химия"],
  },
];

export const RETAIL_REPORT_ENTITY = "Document_ОтчетОРозничныхПродажах";

export const RETAIL_REPORT_SELECT = [
  "Ref_Key",
  "Number",
  "Date",
  "Posted",
  "СуммаДокумента",
  "СуммаВозвратов",
  "Магазин_Key",
  "КассаККМ_Key",
  "Товары",
  "ВозвращенныеТовары",
].join(",");
