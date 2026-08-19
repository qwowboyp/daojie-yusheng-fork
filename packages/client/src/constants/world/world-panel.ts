/**
 * 本文件定义客户端常量或展示配置，是 UI、地图、输入和本地渲染共同依赖的稳定来源。
 *
 * 维护时要保持常量含义清晰，并同步检查消费方，避免把服务端权威规则复制成客户端私有真源。
 */
/**
 * 世界面板文本与指引常量，供 UI 组件使用。
 */
import { TechniqueRealm } from '@mud/shared';
import { t } from '../../ui/i18n';

function worldText(key: string, _fallback?: string): string {
  return t(key);
}

function worldKeySegment(id: string): string {
  return id.replaceAll('_', '-');
}

/** WorldGuide：世界指南条目。 */
export interface WorldGuide {
/**
 * title：title名称或显示文本。
 */

  title: string;  
  /**
 * route：路线相关字段。
 */

  route: string;  
  /**
 * mood：mood相关字段。
 */

  mood: string;  
  /**
 * desc：desc相关字段。
 */

  desc: string;  
  /**
 * resources：resource相关字段。
 */

  resources: string[];  
  /**
 * threats：threat相关字段。
 */

  threats: string[];
}

/** 各修行境界在界面中的展示名称。 */
export const TECH_REALM_LABELS: Record<TechniqueRealm, string> = {
  [TechniqueRealm.Entry]: worldText('world.tech-realm.entry'),
  [TechniqueRealm.Minor]: worldText('world.tech-realm.minor'),
  [TechniqueRealm.Major]: worldText('world.tech-realm.major'),
  [TechniqueRealm.Perfection]: worldText('world.tech-realm.perfection'),
};

/** 按 key 直接映射到对应的标签，方便数据驱动配置。 */
export const TECH_REALM_NAME_BY_KEY: Record<string, string> = {
  Entry: TECH_REALM_LABELS[TechniqueRealm.Entry],
  Minor: TECH_REALM_LABELS[TechniqueRealm.Minor],
  Major: TECH_REALM_LABELS[TechniqueRealm.Major],
  Perfection: TECH_REALM_LABELS[TechniqueRealm.Perfection],
};

/** 各地图的引导信息，用于世界面板的标签与建议路线。 */
const WORLD_GUIDE_DEFS: Record<string, WorldGuide> = {
  yunlai_town: {
    title: '雲來鎮',
    route: '鎮中接主線，西北入青竹林，南門出荒野，北路可轉靈脊嶺。',
    mood: '武道起點',
    desc: '新的主城佈局更緊湊，主線、補給、煉藥與打鐵都圍著主路展開。',
    resources: ['主線任務', '基礎補給', '鎮內試手怪', '可搜索傢俱'],
    threats: ['零散鼠患', '夜間匪徒'],
  },
  qizhen_crossing: {
    title: '棲真渡',
    route: '北臺接回渡陣，西去裂鋒原，東分青蘿谷與寒汐澤，南下赤隕庭。',
    mood: '前線渡城',
    desc: '主城改成三重錯臺加折線街巷，百工、靜氣、行修和舊渡口不再是幾塊平鋪方盒。',
    resources: ['五行路口', '散修交易', '穩脈調息', '練氣補給'],
    threats: ['外行修士混雜', '水線失足', '五行外圖回壓'],
  },
  bamboo_forest: {
    title: '青竹林',
    route: '主徑推礦洞與遺蹟，側路進荒野，南下獸谷。',
    mood: '武俠過渡帶',
    desc: '狼群、蛇妖與竹靈共生，是從江湖搏殺過渡到修行世界的門檻。',
    resources: ['狼牙', '蛇膽', '翠竹心', '步法殘頁'],
    threats: ['噬靈狼', '青鱗竹蛇', '刃竹螳'],
  },
  black_iron_mine: {
    title: '玄鐵礦洞',
    route: '推進鍾乳深區，蒐集礦材與信標核心。',
    mood: '資源高壓區',
    desc: '礦脈靈氣紊亂，材料密集，但補給和走位壓力明顯上升。',
    resources: ['玄鐵礦塊', '晶塵', '信標核心'],
    threats: ['礦魈', '晶背蝠'],
  },
  ancient_ruins: {
    title: '斷碑遺蹟',
    route: '清理符陣看守，接通靈嶺與天穹後段線。',
    mood: '仙道線索區',
    desc: '陣紋、碑靈與殘篇並存，是正式觸碰修仙敘事的區域。',
    resources: ['斷紋石片', '魂墨', '遺蹟鑰石'],
    threats: ['石衛傀', '骨翎夜鴞', '符陣看守'],
  },
  beast_valley: {
    title: '噬魂獸谷',
    route: '先清外圍，再壓谷底王級目標和靈嶺入口。',
    mood: '修仙高危戰區',
    desc: '獸谷裂隙已顯露靈災本相，建議高補給、高功法成熟度再推進。',
    resources: ['血羽', '妖狼骨', '谷底核心', '逆鱗'],
    threats: ['裂齒妖狼', '血羽鴉', '裂淵狼主'],
  },
  wildlands: {
    title: '荒野',
    route: '刷側線材料，補足裝備後回主線。',
    mood: '側線練級區',
    desc: '野獸、匪徒與沼澤妖物混雜，適合補材料與做支線。',
    resources: ['彘牙', '澤鱗', '陰沼絲', '匪徒腰牌'],
    threats: ['獠牙野彘', '澤鱗蜥', '荒野匪徒'],
  },
  spirit_ridge: {
    title: '靈脊嶺',
    route: '先做嶺門試鋒，再接天穹殘宮。',
    mood: '升階門檻區',
    desc: '這裡已經不止是江湖爭殺，更考驗神識、心性與突破準備。',
    resources: ['嶺獸爪', '霜華精粹', '靈嶺行令'],
    threats: ['靈脊虎', '寒翎鶴', '守嶺殘魂'],
  },
  sky_ruins: {
    title: '天穹殘宮',
    route: '補齊天封核心，處理終局王級目標。',
    mood: '高段終局區',
    desc: '天宮已墜，但封印未絕，是當前版本最高危險層。',
    resources: ['星隕金', '天紋殘頁', '天封核心'],
    threats: ['天宮獵者', '殘宮傀儀', '噬星獸'],
  },
};

export const WORLD_GUIDE: Record<string, WorldGuide> = Object.fromEntries(
  Object.entries(WORLD_GUIDE_DEFS).map(([mapId, guide]) => [
    mapId,
    {
      title: worldText(`world.guide.${worldKeySegment(mapId)}.title`, guide.title),
      route: worldText(`world.guide.${worldKeySegment(mapId)}.route`, guide.route),
      mood: worldText(`world.guide.${worldKeySegment(mapId)}.mood`, guide.mood),
      desc: worldText(`world.guide.${worldKeySegment(mapId)}.desc`, guide.desc),
      resources: guide.resources.map((resource, index) => worldText(`world.guide.${worldKeySegment(mapId)}.resource.${index}`, resource)),
      threats: guide.threats.map((threat, index) => worldText(`world.guide.${worldKeySegment(mapId)}.threat.${index}`, threat)),
    },
  ]),
) as Record<string, WorldGuide>;
