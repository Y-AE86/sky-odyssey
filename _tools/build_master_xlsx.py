import os
import sys
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(REPO_ROOT, "浮空星途_数据总表.xlsx")

# Theme palette (Midnight Indigo + Warm Champagne Gold — matches Sky Odyssey)
C_HEADER_BG = "1C2541"
C_HEADER_FG = "F3D9A4"
C_TITLE_BG = "11172B"
C_TITLE_FG = "FFE5B4"
C_SUB_BG = "283457"
C_ZEBRA = "F5F7FC"
C_WHITE = "FFFFFF"
C_BORDER = "D0D7E5"
C_OK_BG = "E6F4EA"
C_OK_FG = "137333"
C_WARN_BG = "FEF7E0"
C_WARN_FG = "B06000"
C_TODO_BG = "FCE8E6"
C_TODO_FG = "C5221F"
C_UR_BG = "F3E8FD"
C_UR_FG = "6B21A8"
C_SSR_BG = "FEF3C7"
C_SSR_FG = "92400E"
C_SR_BG = "DBEAFE"
C_SR_FG = "1E40AF"

thin_side = Side(style="thin", color=C_BORDER)
med_gold = Side(style="medium", color="C5A367")
cell_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)
header_border = Border(left=thin_side, right=thin_side, top=med_gold, bottom=med_gold)

FONT_NAME = "Microsoft YaHei"


def style_sheet(ws, title, subtitle, headers, rows, col_widths=None, status_col=None, rarity_col=None):
    ws.views.sheetView[0].showGridLines = True
    ncols = len(headers)

    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols)
    c1 = ws.cell(row=1, column=1, value=title)
    c1.font = Font(name=FONT_NAME, size=14, bold=True, color=C_TITLE_FG)
    c1.fill = PatternFill("solid", fgColor=C_TITLE_BG)
    c1.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[1].height = 30

    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=ncols)
    c2 = ws.cell(row=2, column=1, value=subtitle)
    c2.font = Font(name=FONT_NAME, size=9.5, color="D6DEF2")
    c2.fill = PatternFill("solid", fgColor=C_SUB_BG)
    c2.alignment = Alignment(horizontal="left", vertical="center", indent=1, wrap_text=True)
    ws.row_dimensions[2].height = 22

    ws.row_dimensions[3].height = 26
    for ci, h in enumerate(headers, start=1):
        cell = ws.cell(row=3, column=ci, value=h)
        cell.font = Font(name=FONT_NAME, size=10.5, bold=True, color=C_HEADER_FG)
        cell.fill = PatternFill("solid", fgColor=C_HEADER_BG)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = header_border

    for ri, row in enumerate(rows, start=4):
        is_zebra = (ri % 2 == 1)
        base_fill = PatternFill("solid", fgColor=C_ZEBRA if is_zebra else C_WHITE)
        max_lines = 1
        for ci, val in enumerate(row, start=1):
            cell = ws.cell(row=ri, column=ci, value=val)
            cell.font = Font(name=FONT_NAME, size=10, color="1F2937")
            cell.fill = base_fill
            cell.border = cell_border
            is_num = isinstance(val, (int, float))
            cell.alignment = Alignment(
                horizontal="center" if (is_num or ci == 1 or ci == status_col or ci == rarity_col) else "left",
                vertical="center",
                wrap_text=True,
            )
            if isinstance(val, str):
                lines = sum(max(1, len(part) // 26 + 1) for part in val.split("\n"))
                max_lines = max(max_lines, lines)

            if status_col and ci == status_col and isinstance(val, str):
                if any(k in val for k in ("已完成", "已实装", "已入库", "已验", "齐备", "已上线")):
                    cell.fill = PatternFill("solid", fgColor=C_OK_BG)
                    cell.font = Font(name=FONT_NAME, size=10, bold=True, color=C_OK_FG)
                elif any(k in val for k in ("待补", "可选", "进行中", "接线", "待接")):
                    cell.fill = PatternFill("solid", fgColor=C_WARN_BG)
                    cell.font = Font(name=FONT_NAME, size=10, bold=True, color=C_WARN_FG)
                elif any(k in val for k in ("缺", "未做", "占位")):
                    cell.fill = PatternFill("solid", fgColor=C_TODO_BG)
                    cell.font = Font(name=FONT_NAME, size=10, bold=True, color=C_TODO_FG)

            if rarity_col and ci == rarity_col and isinstance(val, str):
                if val == "UR":
                    cell.fill = PatternFill("solid", fgColor=C_UR_BG)
                    cell.font = Font(name=FONT_NAME, size=10, bold=True, color=C_UR_FG)
                elif val == "SSR":
                    cell.fill = PatternFill("solid", fgColor=C_SSR_BG)
                    cell.font = Font(name=FONT_NAME, size=10, bold=True, color=C_SSR_FG)
                elif val == "SR":
                    cell.fill = PatternFill("solid", fgColor=C_SR_BG)
                    cell.font = Font(name=FONT_NAME, size=10, bold=True, color=C_SR_FG)

        ws.row_dimensions[ri].height = max(22, min(76, 18 * max_lines + 6))

    ws.freeze_panes = "A4"
    ws.auto_filter.ref = f"A3:{get_column_letter(ncols)}{max(3, 3 + len(rows))}"

    if col_widths:
        for ci, w in enumerate(col_widths, start=1):
            ws.column_dimensions[get_column_letter(ci)].width = w
    else:
        for ci in range(1, ncols + 1):
            ws.column_dimensions[get_column_letter(ci)].width = 18


def build():
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    # ------------------------------------------------------------------
    # Sheet 1: 01_总览与核心规则
    # ------------------------------------------------------------------
    ws1 = wb.create_sheet("01_总览与核心规则")
    rows1 = [
        ["基础定位", "游戏名称 / 代号", "《浮空星途》（sky-odyssey）", "独立项目，与《仙途》彻底隔离；分支 dev/sky-odyssey"],
        ["基础定位", "画幅与技术架构", "纯 16:9 横屏 HiDPI DOM UI + PixiJS v7.4.3 WebGL 6v6 战台", "支持双击 file:// 离线与 GitHub Pages 在线双入口，原图零压缩"],
        ["基础定位", "世界观与美术调性", "星穹浮空城 × 蒸汽魔导 × 多文明幻想（全员 11 位日系美少女星灵）", "参考《龙族：卡塞尔之门》×《重返未来：1999》×《星途天城》"],
        ["视听表现", "动态演出与音频", "14 支动态看板/有声大招 MP4 + 双轨 BGM + 15 层合成音效 + 17 张手绘 ADD 特效", "必杀播片期间 BGM 自动压低至 22%；无视频新角色自动平滑呼吸/斜切"],
        ["存档系统", "独立存档与迁移", "sky_odyssey_save_v1（支持 JSON 导入导出、8人旧档平滑升 11 人）", "旧档 h07/h08 自动映射为望舒/希露，保留全部星级、装备与编队"],
        ["开局赠送", "初始星灵阵容", "6 位满编首发（h04 艾莉娅、h08 苍雷·希露、h05 薇尔、h01 幽冥墨姬、h02 冰灵、h03 凌波玉笛）", "开局即享前 3 后 3 全真画 Q 版六人实战"],
        ["开局赠送", "初始货币与抽卡", "星钻 ×4800、星币 ×6000、唤星券 ×30、共鸣晶核 ×120", "进游戏立刻爽抽 30 连 + 兑换共 60 抽保底 UR"],
        ["开局赠送", "初始装备", "14 件初始星装（6 件 R 级已自动穿戴 + 4 件 SR + 4 件 SSR）", "支持一键配装与整套星装一键强化"],
        ["阵营克制", "四大阵营闭环", "东煌 → 秘影 → 圣辉 → 机巧 → 东煌", "克制方最终伤害提升 +18%（×1.18）"],
        ["阵营羁绊", "同阵营上阵加成", "上阵 2 人 +6% / 4 人 +12% / 6 人 +20%", "同时提升该阵营上阵单位的生命、攻击与防御"],
        ["养成护肝", "全队星位共鸣等级", "1～100 级全队共享，升级消耗：星币 = 280+等级×90，晶核 = 5+等级×2", "抽到新星灵秒继承全额等级，零重置废卡焦虑"],
        ["养成护肝", "星级突破与被动", "1～6 星，升星消耗同名碎片 = 当前星级×12（1→2 需 12 片，5→6 需 60 片）", "3 星解锁攻击+8%；5 星解锁必杀倍率+15%"],
        ["数值公式", "星灵属性成长", "倍率 = 1 + (等级-1)×7.5% + (星级-1)×10.5%；本命武装额外 生命/攻击 +6%", "武器/饰品加攻，星甲/圣物加血防；面板取整显示"],
        ["数值公式", "战力计算", "单人战力 = round(生命×0.5 + 攻击×3 + 防御×2)", "战队总战力为当前上阵 6 人战力之和"],
        ["战斗规则", "6v6 阵型与反派军团", "我方左 6（朝右）vs 敌方右 6（天然朝左专属反派 + 1.52× 巨型浮空机神 BOSS）", "按速度轮流行动，上限 20 回合；普攻优先同路前排"],
        ["战斗规则", "伤害、暴击与护盾", "攻击×倍率×克制×随机(0.94~1.06)×[280/(280+防御)]；浮动上 1/4 记暴击", "先扣护盾再扣血（反弹 30%）；灼烧无视护盾"],
        ["战斗规则", "怒气与打击节奏", "开局怒气：幽冥墨姬 75 / 其余我方 36 / 敌方 18；普攻 +34 怒，受击 +9 怒", "含推镜、顿帧、白红闪击退、手绘弹道与九格序列帧爆发"],
    ]
    style_sheet(
        ws1,
        "《浮空星途》（sky-odyssey）游戏总览与核心底层规则（Wave 6 最新版）",
        "数据来源：js/data.js、js/save.js、js/battle-engine.js、js/battle-pixi.js（截至 2026-11-28 · 提交 e31e355）",
        ["模块分类", "规则项", "当前设定与公式", "设计目的 / 备注"],
        rows1,
        col_widths=[16, 22, 60, 44],
    )

    # ------------------------------------------------------------------
    # Sheet 2: 02_页面与玩法入口
    # ------------------------------------------------------------------
    ws2 = wb.create_sheet("02_页面与玩法入口")
    rows2 = [
        ["主城大厅", "全屏看板舞台", "11 位美少女看板轮换", "h01~h06 & h08 播放静音循环动态视频（h08 为 1080p），其余展示 9.5 分原画呼吸；支持净屏赏图与台词互动", "已实装验收"],
        ["主城大厅", "顶栏左侧", "指挥官头像与战力", "显示星航指挥官头像（圆星环徽章）、全队共鸣等级、总战力", "已实装验收"],
        ["主城大厅", "顶栏中间", "核心资源栏", "高定厚涂星钻、星币、唤星券实时余额，点击直达储物背包", "已实装验收"],
        ["主城大厅", "顶栏右侧", "一键静音 / 画质 / 设置", "一键静音音符、极致画质/省电静态切换、航行设置（双轨音量滑块 + JSON 导出/导入 + PeriTune 署名）", "已实装验收"],
        ["主城大厅", "左侧竖栏 1", "任务（每日任务）", "「例行出航」：每日完成 1 场战斗领星钻 ×80，跨日自动重置", "已实装验收"],
        ["主城大厅", "左侧竖栏 2", "福利（开服福利）", "「启航补给」：单档一次性领唤星券 ×6", "已实装验收"],
        ["主城大厅", "左侧竖栏 3", "图鉴（11 位星灵图鉴）", "两行居中展示全部 11 位正式原画美少女收集状态，含四阵营徽章与技能详览，零剪影占位", "已实装验收"],
        ["主城大厅", "左侧竖栏 4", "背包（储物背包）", "查看 4 种资源、全部星装列表与 11 位星灵碎片持有量", "已实装验收"],
        ["主城大厅", "右侧主磁贴 1", "主线航线（出征）", "浮空飞艇磁贴显示当前进度，点击进入浮空群岛大地图 2 章 10 关推图", "已实装验收"],
        ["主城大厅", "右侧主磁贴 2", "星穹试炼", "高塔横幅入口，直达三大副本（星穹高塔 / 天城首领 / 星环演武）", "已实装验收"],
        ["主城大厅", "右侧副磁贴 3", "星匣挂机（离线收益）", "9.8 分星匣宝箱磁贴，实时累计离线星币与共鸣晶核（上限 8 小时）", "已实装验收"],
        ["主城大厅", "右侧副磁贴 4", "限时活动（七日启航祭）", "礼盒烟花专属磁贴，建档前 7 天每日领唤星券+晶核，第 7 天送 3 券", "已实装验收"],
        ["主城大厅", "右侧副磁贴 5", "星港商店", "奇珍商店磁贴，使用星钻 160:1 兑换唤星券", "已实装验收"],
        ["主城大厅", "右下主底栏", "编队 / 星灵 / 星穹召唤", "鎏金琉璃核心入口直达 6 人编队、星灵养成、双卡池星穹召唤", "已实装验收"],
        ["核心功能页", "星灵养成页", "共鸣与升星 / 星装 / 本命武装 / 技能", "11 位头像底条、左台立绘/Q版切换、右面板全队升级/升星/整套强化/6 把本命专武/4 枚技能纹章", "已实装验收"],
        ["核心功能页", "6 人站位编队", "3×2 前后排战阵", "前排 3 格 + 后排 3 格互换/替补上下阵，右侧实时展示四阵营纹章与羁绊加成", "已实装验收"],
        ["核心功能页", "星穹召唤页", "常驻星穹池 / 东煌限定 UP 池", "全员 11 位星灵进池（UR 2% / SSR 98% / 60抽保底），单抽/十连/重抽/概率表/快捷兑券", "已实装验收"],
        ["核心功能页", "航线推图页", "浮空群岛大地图 · 2 章 10 关", "第 1 章浮空星港、第 2 章齿轮云巅双战台，关底 1-5/2-5 出阵 1.52× 巨型浮空机神 BOSS", "已实装验收"],
        ["核心功能页", "星穹试炼页", "星穹高塔 / 天城首领 / 星环演武", "三大 9.5 分横幅同步预览；高塔每 5 层与天城首领由浮空机神+5 护卫镇守，演武为 6v6 镜像队", "已实装验收"],
        ["核心战斗页", "6v6 PixiJS 战台", "全屏有声必杀 + 手绘特效 + 实机音效", "1×/2×/3× 倍速、自动/手动大招、7 支有声必杀 MP4（含希露 5s）、17 张 ADD 特效、双轨 BGM 与 15 音效", "已实装验收"],
    ]
    style_sheet(
        ws2,
        "《浮空星途》全部页面与玩法入口清单（Wave 6 全员实装版）",
        "20 个核心页面与主城入口已全部完成实画、动效与音频接入，桌面/高分屏/手机横屏/双击 file:// 四端 0 报错通过",
        ["所属板块", "位置 / 分区", "入口名称", "具体玩法与交互说明", "当前完成状态"],
        rows2,
        col_widths=[14, 16, 22, 62, 16],
        status_col=5,
    )

    # ------------------------------------------------------------------
    # Sheet 3: 03_星灵与技能总表 (11位全员美少女)
    # ------------------------------------------------------------------
    ws3 = wb.create_sheet("03_星灵与技能总表")
    heroes_data = [
        ["h01", "幽冥墨姬", "东煌", "UR", "爆发诅咒 · 后排输出", "暗冥(ink)", "是", 1030, 184, 52, 112, "忘川墨镰", "生命/攻击 +6%", "冥花初绽", "九幽墨莲斩", "三段紫焰各造成 105% 攻击伤害，目标攻击下降 20% 持续 2 次行动", "看板5s+必杀3s(有声)", "全套齐备已实装"],
        ["h02", "冰灵 · 霜华", "东煌", "UR", "群体冰控 · 后排法师", "冰霜(ice)", "是", 1060, 167, 51, 104, "霜华星杖", "生命/攻击 +6%", "寒星引", "霜天星落", "对全体敌人造成 118% 攻击冰伤，每位目标 25% 概率冻结 1 次行动", "看板5s+必杀3s(有声)", "全套齐备已实装"],
        ["h03", "凌波玉笛", "东煌", "SSR", "净疗回春 · 后排治疗", "清泉(water)", "是", 1140, 150, 60, 99, "潮生玉笛", "生命/攻击 +6%", "碧波鸣", "清音沧澜曲", "为所有存活友军回复 145% 攻击生命，并清除冻结、减攻和破甲", "看板5s+必杀3s(有声)", "全套齐备已实装"],
        ["h04", "艾莉娅 · 圣翼", "圣辉", "SSR", "护盾援护 · 前排坦克", "圣光(light)", "是", 1520, 130, 88, 92, "白昼圣盾", "生命/攻击 +6%", "破晓盾击", "天穹圣壁", "为前排友军附加 155% 攻击护盾，护盾受击反弹已吸收伤害的 30%", "看板5s+必杀3s(有声)", "全套齐备已实装"],
        ["h05", "薇尔 · 星轨", "机巧", "SSR", "连射追击 · 后排射手", "机巧(gear)", "是", 980, 163, 49, 110, "双子铳星", "生命/攻击 +6%", "轨道弹", "魔导齐射", "发射 4 枚星弹随机索敌，各造成 85% 攻击伤害，每次击破回复 35 怒气", "看板5s+必杀3s(有声)", "全套齐备已实装"],
        ["h06", "莉莉丝 · 绯月", "秘影", "SSR", "切后刺客 · 前排突袭", "绯影(blood)", "否(抽卡)", 1110, 169, 51, 116, "赤月棘刃", "生命/攻击 +6%", "绯刺", "猩红月蚀", "切入敌方后排攻击生命最低目标，造成 265% 攻击伤害并吸血 40%", "看板5s+必杀3s(有声)", "全套齐备已实装"],
        ["h07", "望舒 · 星渊", "秘影", "SSR", "星界统御 · 群体增攻", "暗冥(ink)", "否(抽卡)", 1160, 149, 57, 101, "星渊浑天星杖", "生命/攻击 +6%", "引星入幕", "星渊垂幕", "对全体敌人造成 82% 攻击星界伤害，同路敌人冻结 1 次行动；我方全员攻击+15% 持续 2 次行动", "必杀5s(有声)", "全套齐备已实装"],
        ["h08", "苍雷 · 希露", "机巧", "SSR", "雷霆破甲 · 前排控制", "雷霆(thunder)", "是", 1450, 132, 83, 87, "苍雷弧光太刀", "生命/攻击 +6%", "弧刃引雷", "万雷裁决", "对敌方前排造成 138% 攻击雷伤，防御降低 20% 持续 2 次行动；主目标额外冻结 1 次行动", "1080p看板5s+必杀5s+3s雷剑CG(18HITS)", "全套+四态已实装"],
        ["h09", "离火 · 凰姬", "东煌", "UR", "炽焰灼烧 · 群体爆发", "离火(fire)", "否(抽卡)", 1040, 180, 48, 103, "离火焚天凤枪", "生命/攻击 +6%", "燎羽飞焰", "离火焚天", "对全体敌人造成 112% 攻击火伤；接下来 2 次行动后各承受 32% 攻击无视护盾灼伤", "必杀4s(有声·尾秒待可选重跑)", "全套齐备已实装"],
        ["h10", "汐月 · 瑶光", "圣辉", "SSR", "月潮济航 · 净化回能", "清泉(water)", "否(抽卡)", 1110, 141, 58, 102, "月潮琉璃剑", "生命/攻击 +6%", "潮汐剑纹", "月潮归息", "为全体友军回复 105% 攻击生命，清除控制/减攻/破甲/灼烧，其余友军回复 18 怒气", "必杀4s(有声)", "全套齐备已实装"],
        ["h11", "赛琳娜 · 暗冕", "秘影", "UR", "暗翼斩杀 · 后排收割", "绯影(blood)", "否(抽卡)", 1050, 179, 50, 114, "暗冕鸦羽棘镰", "生命/攻击 +6%", "鸦羽裂锋", "暗冕终裁", "诅咒生命比例最低敌方后排造成 205% 伤害；存活且血量<35%追加 145% 斩杀，并降攻 20% 持续 2 次行动", "待补4s有声大招", "全套原画已实装"],
    ]
    style_sheet(
        ws3,
        "《浮空星途》全 11 位星灵花名册与技能数值总表（4 UR + 7 SSR · 全员美少女）",
        "阵营分布：东煌 4 / 秘影 3 / 圣辉 2 / 机巧 2；3星被动攻击+8%，5星觉醒必杀倍率+15%；全员 100% 正式原画零剪影",
        ["编号", "星灵名称", "阵营", "品阶", "定位与站位", "特效系别", "开局赠送", "基础生命", "基础攻击", "基础防御", "基础速度", "本命武装", "武装加成", "普攻技能", "必杀技名", "必杀技详细效果", "动态视频状态", "美术状态"],
        heroes_data,
        col_widths=[8, 15, 8, 8, 20, 13, 10, 10, 10, 10, 10, 12, 14, 12, 13, 48, 22, 16],
        status_col=18,
        rarity_col=4,
    )

    # ------------------------------------------------------------------
    # Sheet 4: 04_星装与道具资源
    # ------------------------------------------------------------------
    ws4 = wb.create_sheet("04_星装与道具资源")
    rows4 = [
        ["货币资源", "星钻", "diamonds", "UR", "核心高级货币", "推图首通、高塔首通、首领达标、每日任务", "160:1 兑换唤星券（星港商店 / 召唤页）", "assets/items/item_gem.png", "已实装"],
        ["货币资源", "星币", "coins", "SSR", "基础养成货币", "星匣挂机(2/5秒)、战斗结算(胜140/败24)", "全队共鸣升级、星装强化（单次 (lv+1)×95）", "assets/items/item_coin.png", "已实装"],
        ["货币资源", "唤星券", "tickets", "UR", "抽卡专用凭证", "开局送30、开服补给6、七日祭、推图、演武、星钻兑", "常驻星穹池 / 东煌 UP 池单抽与十连", "assets/items/item_ticket.png", "已实装"],
        ["养成材料", "共鸣晶核", "cores", "SSR", "全队升级材料", "星匣挂机(1/分)、战斗结算(胜4/败1)、高塔、首领、七日祭", "全队共鸣等级升级（消耗 5+等级×2）", "assets/items/item_core.png", "已实装"],
        ["养成材料", "星灵碎片", "shards[id]", "SSR", "升星突破材料", "抽卡重复获得（SSR=12 / UR=24 片）", "对应星灵 1→6 星突破（消耗 当前星×12）", "assets/items/item_shard.png", "已实装"],
        ["扩展道具", "星匣宝箱", "item_chest", "SSR", "离线挂机图标", "主城星匣挂机入口专属展示", "展示离线累计奖励", "assets/items/item_chest.png", "已实装"],
        ["扩展道具", "经验星露", "item_dew", "SR", "预留养成道具", "后续活动/副本扩展预留", "预留经验/突破消耗位", "assets/items/item_dew.png", "已入库"],
        ["扩展道具", "强化星尘", "item_dust", "SR", "预留强化材料", "后续星装高阶强化扩展预留", "预留高阶星装突破位", "assets/items/item_dust.png", "已入库"],
        ["扩展道具", "羽翼体力瓶", "item_stamina", "SR", "预留体力道具", "后续大地图探索/体力副本扩展预留", "预留体力回复位", "assets/items/item_stamina.png", "已入库"],
    ]
    gear_names = [
        ("武器", ["星铁短刃", "星纹军刀", "凛光长锋", "群星之刃"], "攻击 +评分×0.65", "gear_weapon_sr.png", "gear_weapon_ur.png"),
        ("星甲", ["巡航轻甲", "星纹软甲", "天光重甲", "星冠圣铠"], "生命 +评分×5，防御 +评分×0.25", "gear_armor_sr.png", "gear_armor_ur.png"),
        ("饰品", ["星图挂坠", "流银指环", "曙光星环", "天穹之泪"], "攻击 +评分×0.40", "gear_accessory_sr.png", "gear_accessory_ur.png"),
        ("圣物", ["见习星盘", "黄铜罗盘", "航星仪", "群星天球"], "生命 +评分×2，防御 +评分×0.15", "gear_relic_sr.png", "gear_relic_ur.png"),
    ]
    rarity_list = ["R", "SR", "SSR", "UR"]
    for slot_name, names, effect, ico_sr, ico_ur in gear_names:
        for rk, gname in enumerate(names):
            rar = rarity_list[rk]
            base_val = (rk + 1) * 14
            ico = ico_ur if rar == "UR" else ico_sr
            src = "开局赠送 / 主线 1-1~1-4 首通" if rk <= 1 else ("开局赠送 / 主线 1-5~2-5 & 高塔 5~15 层" if rk == 2 else "星穹高塔 20/25/30 层首通")
            rows4.append([
                f"星装·{slot_name}", gname, f"slot={slot_name},rank={rk}", rar,
                f"基础评分 {base_val}（每强化+1 增 5 分，上限+50）",
                src, effect, f"assets/items/{ico}", "已实装",
            ])
    style_sheet(
        ws4,
        "《浮空星途》星装与货币道具全量表",
        "星装评分公式 = (品阶档位1~4)×14 + 强化等级×5；强化花费 = (当前强化等级+1)×95 星币（上限 +50，支持一键整套强化）",
        ["大类", "名称", "程序标识", "品阶", "定位 / 基础数值", "主要产出途径", "用途 / 属性公式", "对应无损图标路径", "美术状态"],
        rows4,
        col_widths=[14, 15, 20, 8, 30, 34, 34, 30, 12],
        status_col=9,
        rarity_col=4,
    )

    # ------------------------------------------------------------------
    # Sheet 5: 05_主线航线关卡
    # ------------------------------------------------------------------
    ws5 = wb.create_sheet("05_主线航线关卡")
    enemy_name_map = {
        "enemy_boss_mech": "【BOSS】浮空机神阿斯特拉(1.52×)",
        "enemy_vanguard": "星骸重盾卫",
        "enemy_caster": "虚空星术士",
        "enemy_striker": "齿轮浮游猎手",
    }
    enemy_teams = [
        ["enemy_vanguard", "enemy_vanguard", "enemy_striker", "enemy_caster", "enemy_striker", "enemy_caster"],
        ["enemy_vanguard", "enemy_striker", "enemy_vanguard", "enemy_striker", "enemy_caster", "enemy_caster"],
        ["enemy_striker", "enemy_vanguard", "enemy_vanguard", "enemy_caster", "enemy_caster", "enemy_striker"],
        ["enemy_vanguard", "enemy_vanguard", "enemy_caster", "enemy_striker", "enemy_caster", "enemy_striker"],
        ["enemy_vanguard", "enemy_boss_mech", "enemy_vanguard", "enemy_caster", "enemy_striker", "enemy_caster"],
    ]
    stage_names = [
        "启明星门", "星港浮桥", "雾海灯塔", "破晓船坞", "云港守望者",
        "齿轮边境", "悬空升降井", "逆风钟楼", "天穹熔炉", "云巅之冠",
    ]
    slots_cn = ["武器", "星甲", "饰品", "圣物"]
    rows5 = []
    for i, sname in enumerate(stage_names):
        ch = 1 if i < 5 else 2
        ch_name = "第一章 · 浮空星港" if ch == 1 else "第二章 · 齿轮云巅"
        code = f"{ch}-{i % 5 + 1}"
        pwr = 5400 + i * 750
        scale = round(0.62 + i * 0.085, 3)
        team = enemy_teams[i % 5]
        front_str = " / ".join(enemy_name_map[x] for x in team[:3])
        back_str = " / ".join(enemy_name_map[x] for x in team[3:])
        dm = 100 + 20 * i
        tk = 3 if i % 5 == 4 else 1
        gear_rar = "SSR" if (i + 1) >= 5 else "SR"
        gear_slot = slots_cn[i % 4]
        bg_name = "bg_battle.png (浮空星港)" if ch == 1 else "bg_battle_ch2.png (齿轮云巅)"
        rows5.append([
            i + 1, ch_name, code, sname, pwr, scale,
            front_str, back_str, dm, tk, f"{gear_rar} {gear_slot} ×1", bg_name,
        ])
    style_sheet(
        ws5,
        "《浮空星途》主线航线 10 关完整配置表（专属反派军团与关底浮空机神）",
        "全主线已告别镜像杂兵：普通关为三类专属反派军团，1-5 / 2-5 关底前排中央由 1.52× 巨型浮空机神阿斯特拉镇守",
        ["关卡ID", "所属章节", "关卡号", "关卡名称", "推荐战力", "敌方数值倍率", "敌方前排 (0/1/2)", "敌方后排 (3/4/5)", "首通星钻", "首通唤星券", "首通星装掉落", "战斗场景背景"],
        rows5,
        col_widths=[9, 18, 9, 14, 11, 13, 38, 34, 11, 12, 16, 24],
    )

    # ------------------------------------------------------------------
    # Sheet 6: 06_星穹试炼与副本
    # ------------------------------------------------------------------
    ws6 = wb.create_sheet("06_星穹试炼与副本")
    rows6 = [
        ["星穹高塔", "整体规则", "第 1～30 层", "倍率 = 0.75 + (层数-1)×0.09；普通层专属反派军团，逢 5 层出动 1.52× 浮空机神 BOSS", "首通星钻 = 100 + 层数×6；首通晶核 = 4 + (18 + 层数)；5/10/15 层掉 SSR，20/25/30 层掉 UR！", "banner_tower.png（9.6分）"],
        ["天城首领", "整体规则", "浮空机神(1.52×) + 5 护卫", "专属星穹祭坛战台；敌方倍率 1.02；前排中央阿斯特拉拥有 17 倍生命、1.6 倍攻击", "按我方全队单场总伤害解锁 5 档阶梯奖励，每跨过 1 档即领 星钻×100 + 晶核×12", "banner_boss.png + bg_battle_boss.png"],
        ["天城首领", "伤害档位 1", "3,000 总伤害", "新手 1 级队即可轻松达标", "星钻 ×100 + 共鸣晶核 ×12", "一次性里程碑"],
        ["天城首领", "伤害档位 2", "8,000 总伤害", "全队 5 级+一键强化可达", "星钻 ×100 + 共鸣晶核 ×12", "一次性里程碑"],
        ["天城首领", "伤害档位 3", "15,000 总伤害", "全队 12 级+SSR 装可达", "星钻 ×100 + 共鸣晶核 ×12", "一次性里程碑"],
        ["天城首领", "伤害档位 4", "25,000 总伤害", "中期成军队冲分目标", "星钻 ×100 + 共鸣晶核 ×12", "一次性里程碑"],
        ["天城首领", "伤害档位 5", "40,000 总伤害", "高星觉醒满编毕业目标", "星钻 ×100 + 共鸣晶核 ×12", "一次性里程碑"],
        ["星环演武", "整体规则", "6v6 玩家镜像小队", "倍率 = 0.82 + floor(胜场/3)×0.09；敌方保留星灵镜像小队（含望舒、希露等），每 3 胜升段", "每次获胜稳定领 唤星券×1 + 星币×140 + 晶核×4；逢第 3/6/9… 胜升段领 唤星券×3！", "banner_arena.png（9.6分）"],
    ]
    for fl in [1, 5, 10, 15, 20, 25, 30]:
        sc = round(0.75 + (fl - 1) * 0.09, 2)
        dm = 100 + fl * 6
        cr = 4 + 18 + fl
        gear_drop = "—" if fl % 5 != 0 else (f"UR {slots_cn[(fl-1)%4]} ×1" if fl >= 20 else f"SSR {slots_cn[(fl-1)%4]} ×1")
        rows6.append([
            "星穹高塔节点", f"第 {fl} 层", f"倍率 ×{sc}",
            "【BOSS 层】浮空机神阿斯特拉(1.52×) + 5 护卫" if fl % 5 == 0 else "专属反派军团 6 人满编队",
            f"首通星钻 ×{dm} + 晶核 ×{cr} + 星币 ×140" + (f" + 必掉 {gear_drop}" if gear_drop != "—" else ""),
            "高塔 BOSS 里程碑" if fl % 5 == 0 else "起步首层",
        ])
    style_sheet(
        ws6,
        "《浮空星途》星穹试炼三大副本与关键节点奖励表（Wave 6 BOSS 版）",
        "天城首领与高塔每 5 层均由 1.52× 巨型浮空机神阿斯特拉镇守，星环演武保留 6v6 玩家镜像切磋体验",
        ["试炼玩法", "子项 / 节点", "规模 / 门槛", "难度与敌阵规则", "实际奖励明细", "对应横幅 / 备注"],
        rows6,
        col_widths=[16, 15, 22, 42, 48, 28],
    )

    # ------------------------------------------------------------------
    # Sheet 7: 07_抽卡池与概率保底
    # ------------------------------------------------------------------
    ws7 = wb.create_sheet("07_抽卡池与概率保底")
    rows7 = [
        ["常驻星穹池", "standard", "UR", "2.0%", "60 抽必出 UR（第 60 抽硬保底）", "全 4 位 UR 均分：幽冥墨姬(h01)、冰灵(h02)、离火凰姬(h09)、赛琳娜暗冕(h11)", "重复转 24 枚同名碎片"],
        ["常驻星穹池", "standard", "SSR", "98.0%", "每抽必得 SSR 及以上（已取消 SR 废卡池！）", "全 7 位 SSR 均分：凌波玉笛(h03)、艾莉娅(h04)、薇尔(h05)、莉莉丝(h06)、望舒(h07)、希露(h08)、汐月瑶光(h10)", "重复转 12 枚同名碎片"],
        ["东煌限定 UP 池", "up", "UR", "2.0%", "60 抽必出 UR（与常驻池保底独立累计）", "出 UR 时 75% 为「幽冥墨姬(h01)」，其余 25% 由 冰灵(h02)/离火凰姬(h09)/赛琳娜(h11) 均分", "重复转 24 枚同名碎片"],
        ["东煌限定 UP 池", "up", "SSR", "98.0%", "每抽必得 SSR 及以上（与常驻池保底独立累计）", "全 7 位 SSR 均分", "重复转 12 枚同名碎片"],
        ["新手十连保护", "跨池首十连", "保底规则", "触发一次", "全账号首次十连至少包含 1 位首发东煌主力（h01/h02/h03）", "若前 9 抽未出，第 10 抽按当次品阶锁定 h02(UR) 或 h03(SSR)", "已写入 tests/core.cjs 自动化核验"],
        ["抽卡消耗与兑券", "单抽 / 十连", "通用", "1 券 / 10 券", "唤星券不足时按 160 星钻 = 1 张唤星券 快捷兑换", "开局送 30 券 + 4800 钻（共可抽 60 抽稳拿 1 位保底 UR）", "11 人全池覆盖已通过大样本随机抽样验证"],
    ]
    style_sheet(
        ws7,
        "《浮空星途》星穹召唤双卡池概率与保底明细表（全员 11 人 · 零 SR 爽抽版）",
        "Wave 6 升级：彻底移除旧版 SR 剪影，双池全员覆盖 4 位 UR + 7 位 SSR，基础概率 UR 2% / SSR 98%，各保留 60 抽硬保底",
        ["卡池名称", "池标识", "品阶", "基础概率", "保底机制", "卡池角色分布", "重复转化 / 备注"],
        rows7,
        col_widths=[18, 13, 10, 12, 36, 52, 30],
        rarity_col=3,
    )

    # ------------------------------------------------------------------
    # Sheet 8: 08_日常活动与挂机商店
    # ------------------------------------------------------------------
    ws8 = wb.create_sheet("08_日常活动与挂机商店")
    rows8 = [
        ["离线挂机", "星匣挂机", "常驻 · 最多累计 8 小时", "每 5 秒产 2 星币，每 60 秒产 1 共鸣晶核", "满 8 小时可领：星币 ×11,520 + 共鸣晶核 ×480", "新档预存 2 分钟收益，主城开局即可收菜"],
        ["每日任务", "例行出航", "每日 00:00 刷新（本地日期）", "今日任意完成 1 场战斗（推图/试炼均可）", "星钻 ×80", "领完次日自动重置"],
        ["开服福利", "启航补给", "单档限领 1 次", "建号直接在主城左栏「福利」领取", "唤星券 ×6", "领完置灰"],
        ["限时活动", "七日启航祭 · 第 1～6 天", "建档日起第 1～6 自然日", "每日登录点击领取", "每日领：唤星券 ×1 + 共鸣晶核 ×5", "第 1～6 天共 6 券 + 30 晶核"],
        ["限时活动", "七日启航祭 · 第 7 天", "建档日起第 7 自然日", "第 7 天登录领取终极大奖", "唤星券 ×3 + 共鸣晶核 ×5", "7 天合计 9 张唤星券 + 35 晶核"],
        ["商店系统", "星港商店", "常驻不限次", "使用星钻兑换唤星券", "160 星钻 → 唤星券 ×1", "后续可扩展星币买晶核 / 碎片 / 装备货架"],
        ["音频与设置", "航行设置与双轨音频", "随时可用", "背景音乐(默认46%)与战斗音效(默认82%)独立滑块、一键静音、极致/省电切换", "支持 JSON 导出/导入与 8→11 人旧档自动无损迁移", "底部合规署名 PeriTune；支持 sfx_*.mp3 热插拔"],
    ]
    style_sheet(
        ws8,
        "《浮空星途》日常、活动、挂机与系统设置配置表",
        "轻量护肝运营循环 + 双轨音量与安全存档迁移机制",
        ["系统分类", "活动 / 功能名", "刷新与周期", "触发 / 参与条件", "产出 / 兑换明细", "备注与扩展方向"],
        rows8,
        col_widths=[14, 22, 24, 36, 40, 36],
    )

    # ------------------------------------------------------------------
    # Sheet 9: 09_美术与动画资产台账 (全 6 波追踪)
    # ------------------------------------------------------------------
    ws9 = wb.create_sheet("09_美术与动画资产台账")
    rows9 = [
        ["Wave 0 · 基础框架", "4 档精准对齐品质框 + 进度条 + 圆徽章", "assets/ui/frame_*.png 等（8件）", "620×620 / 1628×130 RGBA", "9.5 / 10", "已实装验收", "内框几何中心零偏移"],
        ["Wave 0 · 首发三女", "h01 幽冥墨姬 / h02 冰灵 / h03 凌波玉笛（三件套×3）", "assets/*/c07,protag,c15.png（9件）", "1672×941 / 1254² / 精抠Q版", "9.1 / 10", "已实装验收", "东煌首发 9 分画风标杆"],
        ["Wave 1 · 高定组件", "9 道具 + 8 星装 + 9 导航图标 + 4 结算大徽章 + 5 洁净按钮页签", "assets/items,icons,ui/*（35件）", "380~450² RGBA", "9.5 / 10", "已实装验收", "全界面告别素白线框，桌面/手机全过"],
        ["Wave 2 · 磁贴横幅", "主城航线/星匣/商店 3 磁贴 + 高塔/首领/演武 3 横幅", "assets/banners/*（6件）", "1672×941 PNG", "9.5 / 10", "已实装验收", "星匣宝箱 9.8 分全场最高"],
        ["Wave 3/3b · 三主力", "h04 艾莉娅 / h05 薇尔 / h06 莉莉丝（日系画风统一重制 9 件）", "assets/*/h04~h06.png（9件）", "1672×941 / 1254² / 精抠Q版", "9.5 / 10", "已实装验收", "与东煌前 3 位画风 100% 统一"],
        ["Wave 3 · 本命专武", "6 把 SSR/UR 专属武器透明精抠切片（h01～h06）", "assets/weapons/weapon_h01~h06.png", "520×520 无损 RGBA", "9.6 / 10", "已实装验收", "本命武装槽清晰居中零白边"],
        ["Wave 4 · 氛围大作", "航线浮空群岛大地图 + 2 章齿轮战台 + 天城祭坛 + 活动磁贴 + 9 纹章", "assets/scenes,banners,badges/*（13件）", "1672×941 / 440² RGBA", "9.4 / 10", "已实装验收", "主城 5 磁贴齐备，3 张专属战台轮换"],
        ["Wave 5 · 手绘特效", "7 张 3×3 必杀序列帧 + 6 普攻弹道 + 4 状态/法阵（纯黑 ADD）", "assets/vfx/*（17件）", "1254×1254 / 纯黑底 PNG", "9.3 / 10", "已实装验收", "Holopix 手绘级特效，支持按元素着色复用"],
        ["Wave 5 · 双轨音频", "主城空灵 BGM + PeriTune 战斗史诗 BGM + 15 层 Web Audio 音效", "assets/audio/bgm_*.mp3 + manifest.js", "原版 MP3 + 合成总线", "9.3 / 10", "已实装验收", "必杀播片压低至 22%；支持 sfx_*.mp3 热覆盖"],
        ["Wave 5 · 12支视频", "h01～h06 全套 5s 循环动态看板 + 3s 有声电影必杀（12 支）", "assets/videos/lobby_cg & ult_h01~06.mp4", "1280×720 H.264 有声/静音", "9.2 / 10", "已实装验收", "主城双层无缝淡入循环，战内有声直播"],
        ["Wave 6 · 5位新女神", "h07 望舒 / h08 希露 / h09 凰姬 / h10 瑶光 / h11 赛琳娜（15 件）", "assets/*/h07~h11.png（15件）", "1672×941 / 1254² / 精抠Q版", "9.5 / 10", "已实装验收", "彻底消灭灰白男剪影，11 人全员美少女"],
        ["Wave 6 · 反派军团", "巨型浮空机神 BOSS + 星骸重盾卫 + 虚空星术士 + 齿轮猎手（4 件）", "assets/chibi/enemy_*.png（4件）", "3.2头身精抠 RGBA（朝左）", "9.4 / 10", "已实装验收", "机神 1.52× 巨型压迫感，主线/高塔/首领全实装"],
        ["Wave 6 · 希露视频", "h08 苍雷·希露 1080p 5s 看板 + 5s 三段式有声大招（2 支）", "assets/videos/lobby_cg_h08 & ult_h08.mp4", "1916×1080 / 5.09s 有声", "9.0 / 10", "已实装验收", "Chrome 实测 5.09s 满播+跳过全通"],
        ["Wave 7 · 丝滑与立体", "60fps 双帧融合 + 冲击波/色散 Shader + 15 单位轮廓光/斜影 + 首屏提速", "js/battle-vfx.js, battle-pixi.js, main.js", "WebGL Shader + 懒加载", "9.3 / 10", "已实装验收", "已同步上线 https://sky.xiaoye-workbench.cn/"],
        ["Wave 7 · 墨姬冰灵四态", "h01 幽冥墨姬 & h02 冰灵 战斗三动作精抠（蓄力/出招/受击共 6 张）", "assets/chibi/chibi_h01,02_{windup,atk,hurt}.png", "精抠 RGBA（朝右16px）", "9.4 / 10", "已实装验收", "鞋底眼线对齐，HTTP/双击全过"],
        ["Wave 8 · 11张专属领域", "h01~h11 全员 11 张专属暗场必杀领域原画（100% 齐备）", "assets/domains/domain_h01~h11.png", "1672×941 暗调原画", "9.5 / 10", "已实装验收", "11 位星灵全员齐备，碎镜与黑白碎屏已按需求关闭"],
        ["Wave 8 · 5新女神专武", "h07~h11 专属本命专武 + 1 把备用魔导星典（6 把精抠切片）", "assets/weapons/weapon_h07~h11.png", "520×520 无损 RGBA", "9.5 / 10", "已实装验收", "全员 11 把本命专武已实装进养成页并含 +6% 共鸣"],
        ["Wave 8B · 3s全屏CG特效", "h01 幽冥墨姬玄墨黑龙(9 HITS) + h08 苍雷希露万雷圣剑(18 HITS)", "assets/videos/vfx_h01,h08.mp4", "720p 3s 纯黑GPU抠像", "9.0 / 10", "已实装验收", "已上线 sky.xiaoye-workbench.cn（支持自动强穿缓存）"],
        ["Wave 9 · 首发全四态", "首发剩余 4 位三动作精抠(h03/04/05/08 共 12 张，含 h01/02 共 18 张)", "assets/chibi/chibi_h03..08_*.png", "精抠 RGBA（朝右16px）", "9.4 / 10", "已实装验收", "首发 6 人全员四态毕业（offline-textures 33 张）"],
        ["Wave 9 · 3支新大招", "ult_h07 望舒(5s) + ult_h09 凰姬(4s暂装) + ult_h10 瑶光(4s)", "assets/videos/ult_h07,09,10.mp4", "720p 有声 MP4", "9.0 / 10", "已实装验收", "全员 10/11 有声必杀上线，仅差最后 1 支 ult_h11"],
        ["Wave 10 · 尾声缺口", "最后 1 支 4s 有声大招(ult_h11 赛琳娜) + 可选重跑 ult_h09 + 超宽 cover", "ult_h11.mp4 / battle-vfx.js", "可灵 720p 4s + 前端精修", "—", "待补生成", "现成 4s 提示词与 Codex 精修单均在交接手册"],
        ["Wave 10 · 可选抛光", "6 个 0.3s 商业真打击短音效 + 《浮空星途》鎏金 Logo + 远期 Spine", "assets/audio/sfx_*.mp3 等", "原版 MP3 / Spine 2D", "—", "可选升级", "已预留热插拔清单，随时可无缝扩充"],
    ]
    style_sheet(
        ws9,
        "《浮空星途》美术与视听全量生产台账（Wave 0 ～ Wave 10 全周期追踪）",
        "当前运行时已入库 150+ 无损 PNG + 19 支 MP4 + 2 支原版 BGM MP3（含归档原件共 632 个媒体文件通过 SHA-256 校验）",
        ["波次 / 分类", "资产内容", "目标路径", "规格 / 格式", "验收评分", "当前状态", "说明与备注"],
        rows9,
        col_widths=[20, 38, 38, 24, 11, 14, 42],
        status_col=6,
    )

    sr = len(rows9) + 5
    ws9.cell(row=sr, column=1, value="进度统计（自动公式）").font = Font(name=FONT_NAME, size=10.5, bold=True, color=C_HEADER_FG)
    ws9.cell(row=sr, column=1).fill = PatternFill("solid", fgColor=C_HEADER_BG)
    summary_items = [
        ("已实装验收项数", f'=COUNTIF(F4:F{3+len(rows9)},"*已实装*")'),
        ("待补生成项数", f'=COUNTIF(F4:F{3+len(rows9)},"*待补*")'),
        ("可选升级项数", f'=COUNTIF(F4:F{3+len(rows9)},"*可选*")'),
        ("台账总项数", f'=COUNTA(A4:A{3+len(rows9)})'),
    ]
    for idx, (label, formula) in enumerate(summary_items, start=2):
        c_lbl = ws9.cell(row=sr, column=idx, value=label)
        c_lbl.font = Font(name=FONT_NAME, size=10, bold=True, color=C_HEADER_FG)
        c_lbl.fill = PatternFill("solid", fgColor=C_SUB_BG)
        c_lbl.alignment = Alignment(horizontal="center", vertical="center")
        c_lbl.border = cell_border
        c_val = ws9.cell(row=sr + 1, column=idx, value=formula)
        c_val.font = Font(name=FONT_NAME, size=11, bold=True, color="1F2937")
        c_val.alignment = Alignment(horizontal="center", vertical="center")
        c_val.border = cell_border
    ws9.row_dimensions[sr].height = 24
    ws9.row_dimensions[sr + 1].height = 24

    # ------------------------------------------------------------------
    # Sheet 10: 10_反派军团与首领总表
    # ------------------------------------------------------------------
    ws10 = wb.create_sheet("10_反派军团与首领总表")
    enemies_data = [
        ["enemy_boss_mech", "浮空机神阿斯特拉", "机巧", "UR", "首领 · 雷场镇压", "雷霆(thunder)", "1.52× (巨型)", "天然朝左", 1450, 132, 83, 87, "雷场贯射", "星核歼灭", "1-5/2-5 关底、高塔每 5 层、天城首领战（前排中央）", "9.2 / 10", "已实装验收"],
        ["enemy_vanguard", "星骸重盾卫", "圣辉", "SSR", "前排坦克 · 护盾援护", "圣光(light)", "1.00×", "天然朝左", 1320, 128, 76, 93, "星骸盾击", "星骸拒守", "主线全关、高塔全层、天城首领护卫", "9.5 / 10", "已实装验收"],
        ["enemy_caster", "虚空星术士", "秘影", "SSR", "后排法师 · 虚空诅咒", "暗冥(ink)", "1.00×", "天然朝左", 1050, 149, 51, 99, "虚光星弹", "虚空裂幕", "主线全关、高塔全层、天城首领护卫", "9.5 / 10", "已实装验收"],
        ["enemy_striker", "齿轮浮游猎手", "机巧", "SSR", "后排猎手 · 斩袭", "机巧(gear)", "1.00×", "天然朝左", 1050, 156, 52, 110, "齿轮穿刺", "齿轮追猎", "主线全关、高塔全层、天城首领护卫", "9.4 / 10", "已实装验收"],
    ]
    style_sheet(
        ws10,
        "《浮空星途》专属反派军团与巨型首领数值与美术总表（Wave 6 新增）",
        "全部 4 只敌方单位均为天然朝左原画（代码零水平镜像），彻底告别敌我照镜子；离线双击纹理包已同步收录",
        ["程序编号", "敌方名称", "阵营", "品阶", "定位", "特效系别", "战内缩放", "原画朝向", "基础生命", "基础攻击", "基础防御", "基础速度", "普攻", "必杀", "出阵玩法", "验收评分", "当前状态"],
        enemies_data,
        col_widths=[18, 20, 8, 8, 22, 14, 14, 10, 10, 10, 10, 10, 12, 12, 36, 11, 14],
        status_col=17,
        rarity_col=4,
    )

    try:
        wb.save(OUT_PATH)
        print(f"Saved master workbook successfully: {OUT_PATH}")
        print(f"Sheets ({len(wb.sheetnames)}): " + ", ".join(wb.sheetnames))
    except PermissionError:
        print(f"WARN: PermissionError writing {OUT_PATH} (probably open in Excel/WPS). Skipping overwrite.")
        sys.exit(2)


if __name__ == "__main__":
    build()
