/* 神降计划·塔 · 初始地点数据（按 assets/map-a.jpg 与 assets/map-b.jpg 的相对排版生成）
 * A区 19 处 / B区 19 处均为 L3，坐标已按地图着色器海拔校验，落在红色陆地内；
 * 「沉船废骨」「阿斯德拉海底废墟」按设定落在海洋（黑色区域）。
 * 说明：地点只保存地理信息，委托任务一律来自「任务管理」的真实数据，
 *       不再内置任何演示任务字段，避免地图与委托列表不一致。 */
const A_BBOX = {"lon0": -104.6, "lon1": -98.8, "lat0": 26.2, "lat1": 31.0};
const B_BBOX = {"lon0": -95.9, "lon1": -88.6, "lat0": 8.8, "lat1": 15.2, "mirror": true};

export const SEED_LOCATIONS = [
  {"id": "a_l3_01", "name": "趣园居（高级住宅区）", "district": "A区", "level": 3, "lat": 30.53, "lon": -100.714, "desc": "城市地图北端的高级别墅区，围墙上刻着塔的浮雕。"},
  {"id": "a_l3_02", "name": "颐梅园", "district": "A区", "level": 3, "lat": 30.342, "lon": -99.345, "desc": "老式园林，梅树四季不谢，湖心亭常年锁着。"},
  {"id": "a_l3_03", "name": "清溪中学", "district": "A区", "level": 3, "lat": 30.126, "lon": -103.84, "desc": "夜间教学楼仍会亮起某间教室的灯。"},
  {"id": "a_l3_04", "name": "京岳大学", "district": "A区", "level": 3, "lat": 29.93, "lon": -101.671, "desc": "旧图书馆地下有未登记的第三层。"},
  {"id": "a_l3_05", "name": "市立图书馆", "district": "A区", "level": 3, "lat": 29.603, "lon": -103.127, "desc": "馆藏索引里存在从未出版的书目。"},
  {"id": "a_l3_06", "name": "紫金国际中心", "district": "A区", "level": 3, "lat": 29.454, "lon": -99.571, "desc": "塔层顶层保留着未开放的七号会议室。"},
  {"id": "a_l3_07", "name": "守夜人酒吧", "district": "A区", "level": 3, "lat": 28.854, "lon": -103.515, "desc": "情报贩子的聚集地，后门通往黑市。"},
  {"id": "a_l3_08", "name": "香榭购物中心", "district": "A区", "level": 3, "lat": 28.864, "lon": -101.358, "desc": "打烊后的橱窗会映出不存在的人影。"},
  {"id": "a_l3_09", "name": "观光特别缆车", "district": "A区", "level": 3, "lat": 28.499, "lon": -99.16, "desc": "夜间班次会经过地图上不存在的站台。"},
  {"id": "a_l3_10", "name": "中心医院", "district": "A区", "level": 3, "lat": 28.374, "lon": -102.645, "desc": "废弃的医疗建筑，夜间常有异响。"},
  {"id": "a_l3_11", "name": "tc新兴科技大厦", "district": "A区", "level": 3, "lat": 28.082, "lon": -100.778, "desc": "核心机房在断网后仍持续上传数据。"},
  {"id": "a_l3_12", "name": "老城居民区", "district": "A区", "level": 3, "lat": 27.962, "lon": -103.069, "desc": "巷弄深处的门牌号会出现重号。"},
  {"id": "a_l3_13", "name": "女巫的市集", "district": "A区", "level": 3, "lat": 27.539, "lon": -99.571, "desc": "只在雨天开市，摊主都不愿报出姓名。"},
  {"id": "a_l3_14", "name": "CDB商业中心", "district": "A区", "level": 3, "lat": 27.333, "lon": -102.999, "desc": "地下车库最底层多出一层不存在的车位。"},
  {"id": "a_l3_15", "name": "美食一条街", "district": "A区", "level": 3, "lat": 27.136, "lon": -101.236, "desc": "凌晨仍有店开着，菜单上写着客人的名字。"},
  {"id": "a_l3_16", "name": "许愿池", "district": "A区", "level": 3, "lat": 26.882, "lon": -100.499, "desc": "投下的硬币次日会回到手中，愿望已被取走。"},
  {"id": "a_l3_17", "name": "绿驿广场", "district": "A区", "level": 3, "lat": 26.714, "lon": -103.481, "desc": "广场钟塔的指针每天会倒退十七分钟。"},
  {"id": "a_l3_18", "name": "训练场", "district": "A区", "level": 3, "lat": 26.493, "lon": -102.408, "desc": "契约者日常训练地，靶场夜里会自行开火。"},
  {"id": "a_l3_19", "name": "桃园绿化公园", "district": "A区", "level": 3, "lat": 26.474, "lon": -100.117, "desc": "桃林深处有一口永不干涸的枯井。"},
  {"id": "b_l3_01", "name": "蝴蝶迷宫", "district": "B区", "level": 3, "lat": 14.995, "lon": -89.585, "desc": "由幻象构成的巨大迷宫，出口每年移动一次。"},
  {"id": "b_l3_02", "name": "海滨木屋", "district": "B区", "level": 3, "lat": 14.688, "lon": -93.075, "desc": "木屋建在浪线上，涨潮时只剩屋顶。"},
  {"id": "b_l3_03", "name": "永夜巢穴", "district": "B区", "level": 3, "lat": 14.438, "lon": -91.308, "desc": "极夜之地，进出的契约者都不再记得时间。"},
  {"id": "b_l3_04", "name": "威尼斯度假村", "district": "B区", "level": 3, "lat": 14.061, "lon": -93.498, "desc": "运河水位由未知装置控制，夜里会倒流。"},
  {"id": "b_l3_05", "name": "九号公馆", "district": "B区", "level": 3, "lat": 13.811, "lon": -89.629, "desc": "公馆九个房间，第九间只在宾客满员时出现。"},
  {"id": "b_l3_06", "name": "湾仔码头", "district": "B区", "level": 3, "lat": 13.626, "lon": -95.002, "desc": "所有到港船只的登记簿都空白一页。"},
  {"id": "b_l3_07", "name": "圣神大教堂", "district": "B区", "level": 3, "lat": 13.44, "lon": -92.257, "desc": "钟声与塔的脉动共振，唱诗班从不摘下面具。"},
  {"id": "b_l3_08", "name": "不归庄园", "district": "B区", "level": 3, "lat": 12.979, "lon": -90.534, "desc": "庄园主人每七年更换一次面孔。"},
  {"id": "b_l3_09", "name": "月亮湾", "district": "B区", "level": 3, "lat": 12.922, "lon": -93.652, "desc": "退潮后露出通向海底的石阶。"},
  {"id": "b_l3_10", "name": "鸣山会所", "district": "B区", "level": 3, "lat": 12.263, "lon": -89.603, "desc": "山腹内是旧时代的加密通讯中枢。"},
  {"id": "b_l3_11", "name": "深沙海岸", "district": "B区", "level": 3, "lat": 12.016, "lon": -93.137, "desc": "沙下埋着无法打捞的金属结构。"},
  {"id": "b_l3_12", "name": "新葡京酒店（顶层赌场）", "district": "B区", "level": 3, "lat": 12.369, "lon": -91.544, "desc": "顶层赌局以记忆为筹码，庄家从不露面。"},
  {"id": "b_l3_13", "name": "沉船废骨", "district": "B区", "level": 3, "lat": 10.463, "lon": -96.925, "desc": "海底沉船的骨架，仍在缓慢漂移。"},
  {"id": "b_l3_14", "name": "万象新天地（游乐园）", "district": "B区", "level": 3, "lat": 10.361, "lon": -90.151, "desc": "停运的设施每到午夜自行启动。"},
  {"id": "b_l3_15", "name": "四国水族馆", "district": "B区", "level": 3, "lat": 12.374, "lon": -91.688, "desc": "水槽里饲养着档案未记载的生物。"},
  {"id": "b_l3_16", "name": "灰烬之地", "district": "B区", "level": 3, "lat": 10.061, "lon": -89.016, "desc": "整片地表覆着温热的灰，脚印隔夜自愈。"},
  {"id": "b_l3_17", "name": "阿斯德拉海底废墟", "district": "B区", "level": 3, "lat": 9.997, "lon": -96.2, "desc": "沉入海底的古城，塔影仍立在原处。"},
  {"id": "b_l3_18", "name": "塞纳港", "district": "B区", "level": 3, "lat": 8.483, "lon": -93.006, "desc": "港口登记的所有船名都带同一个字。"},
  {"id": "b_l3_19", "name": "幽影沼泽", "district": "B区", "level": 3, "lat": 9.668, "lon": -90.357, "desc": "沼泽会复制走入者的声音，直到人被替换。"}
];

/* 区域锚点与固定地点：地图引擎与应用层共用同一份数据，避免两处硬编码 */
export const AREA_LABELS = [
  { id: "area_a", name: "A区", district: "A区", level: 2, lat: 28.6, lon: -101.7, desc: "繁华的隐秘都市，A 区 19 处地点散布其间。" },
  { id: "area_b", name: "B区", district: "B区", level: 2, lat: 12.4, lon: -91.4, desc: "荒凉的暗黑海岸，B 区 19 处地点沿湾分布。" },
  { id: "l1_1", name: "【 未知区域? 】", level: 1, lat: 30, lon: -100, desc: "未知的广袤大陆" },
  { id: "l1_2", name: "【 未知区域? 】", level: 1, lat: -20, lon: 60, desc: "迷雾笼罩的板块" },
  { id: "l1_3", name: "【 未知区域? 】", level: 1, lat: 10, lon: 150, desc: "未被探索的领域" },
  { id: "l4_1", name: "废弃后巷", district: "A区", level: 4, lat: 28.9, lon: -103.6, desc: "酒吧后方的隐藏黑市，仅对资深契约者开放。" }
];

export const DEFAULT_MAP_ITEMS = SEED_LOCATIONS.concat(AREA_LABELS);
