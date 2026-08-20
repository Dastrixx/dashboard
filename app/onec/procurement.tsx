import { MissingSource } from "./shared";

export function OnecProcurement() {
  return (
    <MissingSource
      title="Закуп / Перемещение"
      description="Заявка должна строиться только по фактическим остаткам"
      source="Пока виртуальная таблица остатков 1С не подключена, система не предлагает количество к закупу и не создаёт фиктивные заявки."
    />
  );
}

