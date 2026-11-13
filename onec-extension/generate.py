"""Генерирует XML-исходники расширения 1С «dashboard» (формат выгрузки 2.17).

Запуск:  python -I onec-extension/generate.py <папка выгрузки основной конфигурации>
Пример:  python -I onec-extension/generate.py E:/3kvadrata/1c-config-xml

Результат пишется в onec-extension/src. Модули хранятся отдельно и копируются в src:
onec-extension/Module.bsl (HTTP-сервис) и onec-extension/CommonModule.bsl (логика).
UUID детерминированные (uuid5), поэтому повторный запуск даёт те же файлы.
"""

import re
import shutil
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "src"
NS = uuid.UUID("6f1c0b6e-3a77-4a8e-9f55-2d6c1d9a0b01")

EXT_NAME = "dashboard"
PREFIX = "дш_"
SERVICE = PREFIX + "Дашборд"
ROLE = PREFIX + "ЧтениеДанныхДашборда"
COMMON = PREFIX + "ДашбордСервер"
COMPAT = "Version8_3_15"

# Объекты основной конфигурации, которые заимствуем ради прав на чтение.
ADOPTED = {
    "Catalog": [
        "Номенклатура", "ВидыНоменклатуры", "БазовыеЕдиницыИзмерения",
        "Магазины", "Склады", "ФизическиеЛица", "Контрагенты", "ВидыОплатЧекаККМ",
        "ТоварныеГруппы",
    ],
    "Document": ["ЧекККМ", "ПоступлениеТоваров", "СписаниеТоваров", "ПересчетТоваров"],
    "AccumulationRegister": ["Продажи", "ТоварыНаСкладах"],
}
FOLDER = {"Catalog": "Catalogs", "Document": "Documents",
          "AccumulationRegister": "AccumulationRegisters"}

HEADER = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" '
    'xmlns:app="http://v8.1c.ru/8.2/managed-application/core" '
    'xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" '
    'xmlns:cmi="http://v8.1c.ru/8.2/managed-application/cmi" '
    'xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" '
    'xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" '
    'xmlns:style="http://v8.1c.ru/8.1/data/ui/style" '
    'xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" '
    'xmlns:v8="http://v8.1c.ru/8.1/data/core" '
    'xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" '
    'xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" '
    'xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" '
    'xmlns:xen="http://v8.1c.ru/8.3/xcf/enums" '
    'xmlns:xpr="http://v8.1c.ru/8.3/xcf/predef" '
    'xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" '
    'xmlns:xs="http://www.w3.org/2001/XMLSchema" '
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.17">\n'
)


def uid(*parts):
    return str(uuid.uuid5(NS, "/".join(parts)))


def synonym(text, indent):
    t = "\t" * indent
    return (f"{t}<Synonym>\n{t}\t<v8:item>\n{t}\t\t<v8:lang>ru</v8:lang>\n"
            f"{t}\t\t<v8:content>{text}</v8:content>\n{t}\t</v8:item>\n{t}</Synonym>\n")


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8-sig", newline="\r\n")


def read_main(main, rel):
    return (main / rel).read_text(encoding="utf-8-sig")


def adopted_object(main, kind, name):
    src = read_main(main, f"{FOLDER[kind]}/{name}.xml")
    orig_uuid = re.search(rf"<{kind} uuid=\"([^\"]+)\"", src).group(1)
    info = re.search(r"<InternalInfo>(.*?)</InternalInfo>", src, re.S).group(1)
    gen = []
    for m in re.finditer(r'<xr:GeneratedType name="([^"]+)" category="([^"]+)">', info):
        gname, cat = m.group(1), m.group(2)
        gen.append(
            f'\t\t\t<xr:GeneratedType name="{gname}" category="{cat}">\n'
            f"\t\t\t\t<xr:TypeId>{uid('type', gname)}</xr:TypeId>\n"
            f"\t\t\t\t<xr:ValueId>{uid('value', gname)}</xr:ValueId>\n"
            f"\t\t\t</xr:GeneratedType>\n")
    body = (HEADER + f'\t<{kind} uuid="{uid(kind, name)}">\n'
            f"\t\t<InternalInfo>\n{''.join(gen)}\t\t</InternalInfo>\n"
            f"\t\t<Properties>\n"
            f"\t\t\t<ObjectBelonging>Adopted</ObjectBelonging>\n"
            f"\t\t\t<Name>{name}</Name>\n"
            f"\t\t\t<Comment/>\n"
            f"\t\t\t<ExtendedConfigurationObject>{orig_uuid}</ExtendedConfigurationObject>\n"
            f"\t\t</Properties>\n"
            f"\t\t<ChildObjects/>\n"
            f"\t</{kind}>\n</MetaDataObject>")
    write(OUT / FOLDER[kind] / f"{name}.xml", body)


def main_cfg(main):
    src = read_main(main, "Configuration.xml")
    class_ids = re.findall(r"<xr:ClassId>([^<]+)</xr:ClassId>", src)
    contained = "".join(
        f"\t\t\t<xr:ContainedObject>\n\t\t\t\t<xr:ClassId>{c}</xr:ClassId>\n"
        f"\t\t\t\t<xr:ObjectId>{uid('contained', c)}</xr:ObjectId>\n"
        f"\t\t\t</xr:ContainedObject>\n" for c in class_ids)
    children = ["\t\t\t<Language>Русский</Language>\n"]
    for kind, names in ADOPTED.items():
        children += [f"\t\t\t<{kind}>{n}</{kind}>\n" for n in names]
    children += [f"\t\t\t<CommonModule>{n}</CommonModule>\n" for n, *_ in COMMON_MODULES]
    children.append(f"\t\t\t<Role>{ROLE}</Role>\n")
    children.append(f"\t\t\t<HTTPService>{SERVICE}</HTTPService>\n")
    body = (HEADER + f'\t<Configuration uuid="{uid("configuration")}">\n'
            f"\t\t<InternalInfo>\n{contained}\t\t</InternalInfo>\n"
            "\t\t<Properties>\n"
            "\t\t\t<ObjectBelonging>Adopted</ObjectBelonging>\n"
            f"\t\t\t<Name>{EXT_NAME}</Name>\n"
            + synonym("Выгрузка данных для дашборда аналитики продаж", 3) +
            "\t\t\t<Comment/>\n"
            "\t\t\t<ConfigurationExtensionPurpose>AddOn</ConfigurationExtensionPurpose>\n"
            "\t\t\t<KeepMappingToExtendedConfigurationObjectsByIDs>true</KeepMappingToExtendedConfigurationObjectsByIDs>\n"
            f"\t\t\t<NamePrefix>{PREFIX}</NamePrefix>\n"
            f"\t\t\t<ConfigurationExtensionCompatibilityMode>{COMPAT}</ConfigurationExtensionCompatibilityMode>\n"
            "\t\t\t<DefaultRunMode>ManagedApplication</DefaultRunMode>\n"
            "\t\t\t<UsePurposes>\n\t\t\t\t<v8:Value xsi:type=\"app:ApplicationUsePurpose\">PlatformApplication</v8:Value>\n\t\t\t</UsePurposes>\n"
            "\t\t\t<ScriptVariant>Russian</ScriptVariant>\n"
            "\t\t\t<DefaultRoles/>\n"
            "\t\t\t<Vendor>dashboard</Vendor>\n"
            "\t\t\t<Version>1.0.0</Version>\n"
            "\t\t\t<DefaultLanguage>Language.Русский</DefaultLanguage>\n"
            "\t\t</Properties>\n"
            f"\t\t<ChildObjects>\n{''.join(children)}\t\t</ChildObjects>\n"
            "\t</Configuration>\n</MetaDataObject>")
    write(OUT / "Configuration.xml", body)

    lang_src = read_main(main, "Languages/Русский.xml")
    lang_uuid = re.search(r'<Language uuid="([^"]+)"', lang_src).group(1)
    write(OUT / "Languages" / "Русский.xml", HEADER +
          f'\t<Language uuid="{uid("language")}">\n'
          "\t\t<InternalInfo/>\n\t\t<Properties>\n"
          "\t\t\t<ObjectBelonging>Adopted</ObjectBelonging>\n"
          "\t\t\t<Name>Русский</Name>\n\t\t\t<Comment/>\n"
          f"\t\t\t<ExtendedConfigurationObject>{lang_uuid}</ExtendedConfigurationObject>\n"
          "\t\t\t<LanguageCode>ru</LanguageCode>\n"
          "\t\t</Properties>\n\t</Language>\n</MetaDataObject>")


def role():
    write(OUT / "Roles" / f"{ROLE}.xml", HEADER +
          f'\t<Role uuid="{uid("role")}">\n\t\t<Properties>\n'
          f"\t\t\t<Name>{ROLE}</Name>\n"
          + synonym("Чтение данных дашборда (HTTP-сервис)", 3) +
          "\t\t\t<Comment/>\n\t\t</Properties>\n\t</Role>\n</MetaDataObject>")
    objects = []
    for kind, names in ADOPTED.items():
        for n in names:
            objects.append(
                f"\t<object>\n\t\t<name>{kind}.{n}</name>\n"
                "\t\t<right>\n\t\t\t<name>Read</name>\n\t\t\t<value>true</value>\n\t\t</right>\n"
                "\t</object>\n")
    # Без права «Использование» на метод HTTP-сервиса платформа отвечает 403
    # «Недостаточно прав для использования ресурса с данным HTTP методом».
    objects.append(
        f"\t<object>\n\t\t<name>HTTPService.{SERVICE}.URLTemplate.Ресурс.Method.GET</name>\n"
        "\t\t<right>\n\t\t\t<name>Use</name>\n\t\t\t<value>true</value>\n\t\t</right>\n"
        "\t</object>\n")
    write(OUT / "Roles" / ROLE / "Ext" / "Rights.xml",
          '<?xml version="1.0" encoding="UTF-8"?>\n'
          '<Rights xmlns="http://v8.1c.ru/8.2/roles" xmlns:xs="http://www.w3.org/2001/XMLSchema" '
          'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="Rights" version="2.17">\n'
          "\t<setForNewObjects>false</setForNewObjects>\n"
          "\t<setForAttributesByDefault>true</setForAttributesByDefault>\n"
          "\t<independentRightsOfChildObjects>false</independentRightsOfChildObjects>\n"
          + "".join(objects) + "</Rights>")


def http_service():
    body = (HEADER + f'\t<HTTPService uuid="{uid("service")}">\n'
            "\t\t<Properties>\n"
            f"\t\t\t<Name>{SERVICE}</Name>\n"
            + synonym("Дашборд аналитики продаж", 3) +
            "\t\t\t<Comment/>\n"
            "\t\t\t<RootURL>dashboard</RootURL>\n"
            "\t\t\t<ReuseSessions>AutoUse</ReuseSessions>\n"
            "\t\t\t<SessionMaxAge>20</SessionMaxAge>\n"
            "\t\t</Properties>\n"
            "\t\t<ChildObjects>\n"
            f'\t\t\t<URLTemplate uuid="{uid("template")}">\n'
            "\t\t\t\t<Properties>\n"
            "\t\t\t\t\t<Name>Ресурс</Name>\n"
            + synonym("Ресурс", 5) +
            "\t\t\t\t\t<Comment/>\n"
            "\t\t\t\t\t<Template>/v1/{resource}</Template>\n"
            "\t\t\t\t</Properties>\n"
            "\t\t\t\t<ChildObjects>\n"
            f'\t\t\t\t\t<Method uuid="{uid("method-get")}">\n'
            "\t\t\t\t\t\t<Properties>\n"
            "\t\t\t\t\t\t\t<Name>GET</Name>\n"
            + synonym("GET", 7) +
            "\t\t\t\t\t\t\t<Comment/>\n"
            "\t\t\t\t\t\t\t<HTTPMethod>GET</HTTPMethod>\n"
            "\t\t\t\t\t\t\t<Handler>РесурсGET</Handler>\n"
            "\t\t\t\t\t\t</Properties>\n"
            "\t\t\t\t\t</Method>\n"
            "\t\t\t\t</ChildObjects>\n"
            "\t\t\t</URLTemplate>\n"
            "\t\t</ChildObjects>\n"
            "\t</HTTPService>\n</MetaDataObject>")
    write(OUT / "HTTPServices" / f"{SERVICE}.xml", body)
    module = (HERE / "Module.bsl").read_text(encoding="utf-8-sig")
    write(OUT / "HTTPServices" / SERVICE / "Ext" / "Module.bsl", module)


# (имя, синоним, файл, повторное использование возвращаемых значений)
COMMON_MODULES = [
    (COMMON, "Дашборд: выгрузка данных", "CommonModule.bsl", "DontUse"),
    (PREFIX + "ДашбордАдминистрирование", "Дашборд: администрирование", "AdminModule.bsl", "DontUse"),
    (PREFIX + "ДашбордКэш", "Дашборд: кэш выборок на время сеанса", "CacheModule.bsl", "DuringSession"),
]


def common_modules():
    for name, title, source, reuse in COMMON_MODULES:
        common_module(name, title, source, reuse)


def common_module(name, title, source, reuse="DontUse"):
    props = [("Global", "false"), ("ClientManagedApplication", "false"),
             ("Server", "true"), ("ExternalConnection", "true"),
             ("ClientOrdinaryApplication", "false"), ("ServerCall", "false"),
             ("Privileged", "false"), ("ReturnValuesReuse", reuse)]
    tab = chr(9)
    nl = chr(10)
    key = "common-module" if name == COMMON else "common-module/" + name
    body = (HEADER + f'{tab}<CommonModule uuid="{uid(key)}">{nl}{tab*2}<Properties>{nl}'
            f"{tab*3}<Name>{name}</Name>{nl}"
            + synonym(title, 3)
            + f"{tab*3}<Comment/>{nl}"
            + "".join(f"{tab*3}<{k}>{v}</{k}>{nl}" for k, v in props)
            + f"{tab*2}</Properties>{nl}{tab}</CommonModule>{nl}</MetaDataObject>")
    write(OUT / "CommonModules" / f"{name}.xml", body)
    module = (HERE / source).read_text(encoding="utf-8-sig")
    write(OUT / "CommonModules" / name / "Ext" / "Module.bsl", module)


def run():
    main = Path(sys.argv[1])
    if OUT.exists():
        shutil.rmtree(OUT)
    main_cfg(main)
    for kind, names in ADOPTED.items():
        for n in names:
            adopted_object(main, kind, n)
    common_modules()
    role()
    http_service()
    print("OK:", OUT)


if __name__ == "__main__":
    run()
