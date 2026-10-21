// ---------- i18n: Bot X-Ray localisation (O'zbek / English) ----------
// Usage: import { t, lang, setLang, translateTag, translateEdge, translateRule, translateVerdict, translateStill, translateLuckVerdict, translateKind, formatMonth, formatNiceDate } from './i18n.js';

const S = {
  // ── brand / header ──
  'brand.tagline':        { en: 'public data, your machine',              uz: "ochiq ma’lumot, sizning kompyuteringiz" },
  'input.placeholder':    { en: 'Paste a Polymarket wallet or username',  uz: "Polymarket hamyon yoki foydalanuvchi nomini kiriting" },
  'btn.xray':             { en: 'X-ray it',                              uz: 'Tekshirish' },

  // ── tab names ──
  'tab.wallet':    { en: 'Wallet',                uz: 'Hamyon' },
  'tab.does':      { en: 'What it does',          uz: 'Nima qiladi' },
  'tab.luck':      { en: 'Skill or luck',         uz: 'Mahorat yoki omad' },
  'tab.working':   { en: 'Still working?',        uz: 'Hali ishlayaptimi?' },
  'tab.convert':   { en: 'Trade it with a broker', uz: 'Broker orqali savdo' },
  'tab.winning':   { en: "Who's winning now",     uz: 'Hozir kim yutmoqda' },
  'tab.live':      { en: 'Live gap',              uz: 'Jonli farq' },
  'tab.strategy':  { en: 'Strategy (paper)',      uz: 'Strategiya (qog‘oz)' },
  'tab.claude':    { en: 'Connect Claude',        uz: 'Claude ulash' },

  // ── welcome screen ──
  'welcome.kicker':   { en: 'Bot X-Ray',  uz: 'Bot X-Ray' },
  'welcome.h1':       { en: 'Reverse engineer any Polymarket bot from its public trades.',                    uz: 'Har qanday Polymarket botini ochiq savdolari orqali teskari muhandislik qiling.' },
  'welcome.sub':      { en: "Paste a wallet or a username above. Every trade on Polymarket is public, so you can see exactly what a bot did, whether it was skill or luck, and whether it still works. No account needed.",
                         uz: "Yuqoriga hamyon yoki foydalanuvchi nomini kiriting. Polymarket’dagi har bir savdo ochiq, shuning uchun bot aynan nima qilganini, bu mahorat yoki omad ekanligini va hali ishlayotganini ko‘rishingiz mumkin. Hisob ochish shart emas." },
  'welcome.try':      { en: 'try one of the three from the video ↑',  uz: 'videodagi uchta botdan birini sinab ko‘ring ↑' },

  // ── progress ──
  'progress.xraying': { en: 'X-raying',   uz: 'Tekshirilmoqda' },
  'progress.start':   { en: 'Starting',   uz: 'Boshlanmoqda' },
  'progress.note':    { en: "A fast bot takes a few seconds. A slow one can take 30 seconds the first time, while its trades and every market's result load. After that it's cached.",
                         uz: "Tez bot bir necha soniya oladi. Sekin bot birinchi marta 30 soniya olishi mumkin — savdolari va har bir bozor natijasi yuklanadi. Shundan so‘ng keshlanadi." },

  // ── error ──
  'error.couldnt':  { en: "Couldn't x-ray",  uz: 'Tekshirib bo‘lmadi' },
  'error.try':      { en: "Try a username from a Polymarket profile page, or the wallet address (it starts 0x and is 42 characters long).",
                       uz: "Polymarket profil sahifasidagi foydalanuvchi nomini yoki hamyon manzilini (0x bilan boshlanadi va 42 ta belgidan iborat) kiritib ko‘ring." },

  // ── wallet screen ──
  'wallet.made.stopped':     { en: '{{name}} made {{pnl}}, then stopped on {{date}}.',                      uz: '{{name}} {{pnl}} ishlab topdi, keyin {{date}} da to‘xtadi.' },
  'wallet.made.active':      { en: "{{name}} has made {{pnl}} since {{date}}, and it's still trading.",      uz: '{{name}} {{date}} dan beri {{pnl}} ishlab topdi va hali ham savdo qilmoqda.' },
  'wallet.sub':              { en: '{{volume}} traded, {{perDollar}} kept on every dollar. {{trades}} trades. Fees paid {{fees}}.', uz: '{{volume}} savdo qilindi, har bir dollardan {{perDollar}} saqlab qolindi. {{trades}} ta savdo. To‘langan komissiya: {{fees}}.' },
  'wallet.stat.lifetime':    { en: 'Lifetime P&L, after fees',     uz: 'Umumiy F/Z, komissiyadan so‘ng' },
  'wallet.stat.traded':      { en: 'Traded',                       uz: 'Savdo hajmi' },
  'wallet.stat.perDollar':   { en: 'Profit per $ traded',          uz: 'Har $ savdodan sof foyda' },
  'wallet.stat.fees':        { en: 'Fees paid',                    uz: 'To‘langan komissiyalar' },
  'wallet.stat.rebates':     { en: 'Rebates and rewards',          uz: 'Qaytarilgan mablag‘ va mukofotlar' },
  'wallet.stat.leaderboard': { en: 'Leaderboard P&L (settled trades only)', uz: 'Reyting F/Z (faqat yakunlangan savdolar)' },
  'wallet.h2.monthly':       { en: 'Month by month',               uz: 'Oylar bo‘yicha' },
  'wallet.th.month':         { en: 'Month',       uz: 'Oy' },
  'wallet.th.pnl':           { en: 'P&L',         uz: 'F/Z' },
  'wallet.th.traded':        { en: 'Traded',       uz: 'Hajm' },
  'wallet.th.profitPer':     { en: 'Profit per $', uz: 'Har $ dan foyda' },
  'wallet.th.fees':          { en: 'Fees',         uz: 'Komissiya' },
  'wallet.th.days':          { en: 'Days trading', uz: 'Savdo kunlari' },
  'wallet.h2.ruleChanges':   { en: 'What the rule changes did',  uz: 'Qoidalar o‘zgarishi qanday ta’sir qildi' },
  'wallet.th.date':          { en: 'Date',                        uz: 'Sana' },
  'wallet.th.change':        { en: 'Change',                      uz: 'O‘zgarish' },
  'wallet.th.2wBefore':      { en: 'Average day, 2 weeks before', uz: '2 hafta oldingi o‘rtacha kun' },
  'wallet.th.2wAfter':       { en: '2 weeks after',               uz: '2 hafta keyin' },
  'wallet.stopped.label':    { en: 'stopped',                     uz: 'to‘xtadi' },
  'wallet.noTrading':        { en: 'no trading',                  uz: 'savdo yo‘q' },
  'wallet.foot':             { en: "P&L is Polymarket's daily series for this wallet (data-api.polymarket.com/v2/user-pnl): it includes fees, rebates and rewards, and open positions at their current price. The leaderboard shows settled trades only, so it reads a little different. Blue marks are the dates Polymarket changed the rules for crypto markets.",
                                uz: "F/Z — bu hamyonning Polymarket kunlik ma’lumotlari (data-api.polymarket.com/v2/user-pnl): komissiya, qaytarilgan mablag‘lar va joriy narxdagi ochiq pozitsiyalarni o‘z ichiga oladi. Reyting faqat yakunlangan savdolarni ko‘rsatadi, shu sababli biroz farq qiladi. Moviy belgilar — Polymarket kripto bozorlar qoidalarini o‘zgartirgan sanalar." },
  'wallet.stoppedDaysAfter': { en: 'stopped {{n}} days later',    uz: '{{n}} kundan keyin to‘xtadi' },

  // ── does screen ──
  'does.from':            { en: 'From {{trades}} trades between {{start}} and {{end}} UTC ({{why}}).', uz: '{{start}} va {{end}} UTC oralig‘idagi {{trades}} ta savdodan ({{why}}).' },
  'does.h2.binance':      { en: 'Did it follow Binance?',    uz: 'Binance’ga ergashdimi?' },
  'does.binance.desc':    { en: "Buys in the 5- and 15-minute {{coin}} markets right after {{coin}} moved more than 0.03% on Binance. A coin flip is 50%.",
                             uz: "{{coin}} Binance’da 0.03% dan ko‘proq harakat qilgandan so‘ng 5 va 15 daqiqalik {{coin}} bozorlarida sotib olishlar. Tanga tashlash — 50%." },
  'does.binance.noShort': { en: 'No short Up or Down trades in the sample.', uz: 'Namunada qisqa muddatli Up yoki Down savdolari yo‘q.' },
  'does.h2.markets':      { en: 'Which markets',              uz: 'Qaysi bozorlar' },
  'does.stat.bothSides':  { en: 'Markets where it bought both sides',  uz: 'Har ikki tomonni sotib olgan bozorlar' },
  'does.stat.pairCost':   { en: 'What a pair cost it (Up + Down)',     uz: 'Juftlik necha pulga tushgan (Up + Down)' },
  'does.stat.balance':    { en: 'Amounts on each side',                uz: 'Har bir tomondagi miqdorlar' },
  'does.stat.balance.equal':  { en: 'Near-equal',  uz: 'Deyarli teng' },
  'does.stat.balance.uneven': { en: 'Uneven',      uz: 'Notekis' },
  'does.stat.sells':      { en: 'How often it sold',                   uz: 'Qanchalik tez-tez sotgan' },
  'does.stat.sells.never':{ en: 'Never',                               uz: 'Hech qachon' },
  'does.stat.sampleResult':   { en: 'Sample result ({{n}} settled markets)',  uz: 'Namuna natijasi ({{n}} ta yakunlangan bozor)' },
  'does.stat.paidBelow':      { en: 'Paid below a fair price from Binance, a share', uz: 'Binance adolatli narxidan past to‘langan (ulush boshiga)' },
  'does.h2.byPrice':      { en: 'P&L by the price it paid',  uz: 'To‘langan narx bo‘yicha F/Z' },
  'does.byPrice.desc':    { en: "Every buy in a market that has ended, grouped by its price. A price is the market's chance: 54¢ means 54%.",
                             uz: "Tugagan bozordagi har bir xarid, narxi bo‘yicha guruhlangan. Narx — bu bozor ehtimoli: 54¢ degani 54%." },
  'does.th.pricePaid':    { en: 'Price paid',      uz: 'To‘langan narx' },
  'does.th.buys':         { en: 'Buys',            uz: 'Xaridlar' },
  'does.th.spent':        { en: 'Spent',           uz: 'Sarflangan' },
  'does.th.avgPrice':     { en: 'Average price',   uz: 'O‘rtacha narx' },
  'does.th.won':          { en: 'Won',             uz: 'Yutgan' },
  'does.th.return':       { en: 'Return',          uz: 'Daromadlilik' },
  'does.h2.sampleMarkets':{ en: 'The markets in the sample', uz: 'Namunadagi bozorlar' },
  'does.th.market':       { en: 'Market',          uz: 'Bozor' },
  'does.th.trades':       { en: 'Trades',          uz: 'Savdolar' },
  'does.th.bought':       { en: 'Bought',          uz: 'Sotib olingan' },
  'does.th.pair':         { en: 'Pair',            uz: 'Juftlik' },
  'does.th.winner':       { en: 'Winner',          uz: 'G‘olib' },
  'does.open':            { en: 'open',            uz: 'ochiq' },
  'does.foot':            { en: "Trades from data-api.polymarket.com/activity, results from gamma-api.polymarket.com, prices from Binance's 1-second candles. Fair price: a normal model on Binance's move since the window opened. Polymarket settles on Chainlink's price, so it carries a small basis error.",
                             uz: "Savdolar data-api.polymarket.com/activity dan, natijalar gamma-api.polymarket.com dan, narxlar Binance’ning 1 soniyalik ma’lumotlaridan olingan. Adolatli narx: oyna ochilganidan buyon Binance harakatiga nisbatan oddiy model. Polymarket hisob-kitobni Chainlink narxida amalga oshiradi, shu sababli kichik bazis farqi mavjud." },
  'does.lastSeconds':     { en: 'last {{lag}} seconds',   uz: 'oxirgi {{lag}} soniya' },
  'does.buysCount':       { en: '{{n}} buys',             uz: '{{n}} ta xarid' },
  'does.coinFlip':        { en: 'coin flip',              uz: 'tanga tashlash' },
  'does.tradesTheLag':    { en: 'it trades the lag',      uz: 'kechikishdan foydalanadi' },
  'does.ignoresBinance':  { en: 'ignores Binance',        uz: 'Binance’ga e’tibor bermaydi' },

  // ── luck screen ──
  'luck.headsInRow':      { en: 'the chance of {{days}} heads in a row: its longest run of green days', uz: 'ketma-ket {{days}} marta gerb tushish ehtimoli: eng uzun yashil kunlar seriyasi' },
  'luck.greenDays':       { en: 'of its full trading days were green',  uz: 'to‘liq savdo kunlarining yashil bo‘lgan ulushi' },
  'luck.lotto':           { en: 'Rarer than winning the UK Lotto jackpot {{n}} times running.', uz: 'Buyuk Britaniya Lotto jekpotini ketma-ket {{n}} marta yutishdan ham kamyob.' },
  'luck.stat.greenOf':    { en: 'Full trading days that were green',    uz: 'Yashil bo‘lgan to‘liq savdo kunlari' },
  'luck.stat.longestRun': { en: 'Longest green run',                    uz: 'Eng uzun yashil seriya' },
  'luck.stat.longestRunDates': { en: 'Longest green run, {{from}} to {{to}}', uz: 'Eng uzun yashil seriya, {{from}} dan {{to}} gacha' },
  'luck.stat.sharpe':     { en: 'Sharpe ratio, a year',                 uz: 'Sharpe koeffitsiyenti (yillik)' },
  'luck.stat.tstat':      { en: 't-stat of the average day',            uz: 'O‘rtacha kunning t-statistikasi' },
  'luck.stat.psr':        { en: 'Probabilistic Sharpe (chance the edge is real)', uz: 'Ehtimoliy Sharpe (ustunlik haqiqiyligi ehtimoli)' },
  'luck.stat.worstDay':   { en: 'Worst day',                            uz: 'Eng yomon kun' },
  'luck.stat.worstDayDate':{ en: 'Worst day, {{date}}',                 uz: 'Eng yomon kun, {{date}}' },
  'luck.stat.maxDd':      { en: 'Biggest drop from a high',             uz: 'Cho‘qqidan eng katta pasayish (max drawdown)' },
  'luck.stat.coinGreen':  { en: 'A coin flip gives this many green days', uz: 'Tanga tashlash shuncha yashil kun beradi' },
  'luck.foot':            { en: "Sharpe uses 365 days a year, because crypto markets trade every day. The probabilistic Sharpe ratio allows for skew and fat tails. These checks say the edge was real while it ran. They can't say it will last: the next screen covers that.",
                             uz: "Sharpe yiliga 365 kunni ishlatadi, chunki kripto bozorlar har kuni ishlaydi. Ehtimoliy Sharpe koeffitsiyenti assimetriya va qalin dumlarni hisobga oladi. Bu tekshiruvlar bot ishlagan davrda ustunlik haqiqiy bo‘lganini ko‘rsatadi. Lekin u bundan keyin ham davom etishini kafolatlay olmaydi: keyingi ekran buni ko‘rib chiqadi." },
  'luck.worstDayLabel':   { en: 'worst day',  uz: 'eng yomon kun' },
  'luck.days':            { en: '{{n}} days',  uz: '{{n}} kun' },

  // ── working screen ──
  'working.h2.profitPerDollar': { en: 'Profit on every dollar traded, by month', uz: 'Savdo qilingan har bir dollardan olingan foyda, oylar bo‘yicha' },
  'working.th.window':    { en: 'Window',            uz: 'Davr' },
  'working.lastDays':     { en: 'Last {{n}} days',   uz: 'Oxirgi {{n}} kun' },
  'working.lifetime':     { en: 'Lifetime',          uz: 'Butun davr' },
  'working.th.trades':    { en: 'Trades',            uz: 'Savdolar' },
  'working.h2.feesVsProfit': { en: 'Fees against profit', uz: 'Foydaga nisbatan komissiyalar' },
  'working.bar.before':   { en: 'Made before fees',   uz: 'Komissiyadan oldingi daromad' },
  'working.bar.fees':     { en: 'Fees paid',          uz: 'To‘langan komissiya' },
  'working.bar.kept':     { en: 'Kept',               uz: 'Sof saqlab qolingan' },
  'working.feesTook':     { en: 'fees took {{pct}}',   uz: 'komissiya {{pct}} qismini oldi' },
  'working.foot':         { en: "Profit per dollar is the month's P&L over the dollars it traded. Months with very little trading are left out of the chart.",
                             uz: "Har dollardan olingan foyda — bu oyning F/Z ko‘rsatkichini savdo qilingan dollarlarga bo‘lishdir. Savdo juda kam bo‘lgan oylar grafikdan chiqarib tashlangan." },
  'working.footActive':   { en: "This month's numbers are still moving, and rebates for it may not be paid yet.",
                             uz: "Ushbu oyning ko‘rsatkichlari hali ham o‘zgarmoqda va keshbeklar hali to‘lanmagan bo‘lishi mumkin." },
  'working.now':          { en: 'now', uz: 'hozir' },

  // ── convert screen ──
  'convert.rerun':        { en: 'Run the x-ray again to see the conversion.', uz: 'Moslashtirishni ko‘rish uchun x-ray’ni qayta ishga tushiring.' },
  'convert.traded':       { en: "{{name}} traded Polymarket's yes-or-no markets.", uz: '{{name}} Polymarket’ning ha-yoki-yo‘q bozorlarida savdo qilgan.' },
  'convert.hereshow':     { en: "Here's how its trick converts to markets a broker offers.", uz: 'Mana uning usuli broker taklif qiladigan bozorlarga qanday moslashadi.' },
  'convert.noVersion':    { en: 'Its trick has no broker version.',  uz: 'Bu usulning broker versiyasi mavjud emas.' },
  'convert.onPoly':       { en: 'On Polymarket:',                   uz: 'Polymarket’da:' },
  'convert.status.built': { en: 'Built in, runs on paper',          uz: 'O‘rnatilgan, qog‘ozda ishlaydi' },
  'convert.status.claude':{ en: 'Claude builds it',                 uz: 'Claude yaratadi' },
  'convert.status.no':    { en: "Doesn't convert",                  uz: 'Moslashtirib bo‘lmaydi' },
  'convert.builtIn':      { en: 'built in',            uz: 'o‘rnatilgan' },
  'convert.claudeBuilds': { en: 'Claude builds it',    uz: 'Claude yaratadi' },
  'convert.doesntConvert':{ en: "doesn't convert",     uz: 'moslashtirib bo‘lmaydi' },
  'convert.h2.whoBuild':  { en: 'Who builds it',       uz: 'Kim yaratadi' },
  'convert.builtin.desc': { en: 'Bot X-Ray already runs this on paper.', uz: 'Bot X-Ray buni allaqachon qog‘ozda ishlatmoqda.' },
  'convert.openStrategy': { en: 'Open the Strategy screen', uz: 'Strategiya sahifasini oching' },
  'convert.turnOn':       { en: 'and turn on',          uz: 'va yoqing' },
  'convert.h2.claudeBuilds':{ en: 'Who builds it: Claude', uz: 'Kim yaratadi: Claude' },
  'convert.claude.desc':  { en: "Bot X-Ray doesn't ship this version. Paste this into Claude Code in the bot-x-ray folder and Claude writes it as a plug-in that runs on paper on the Strategy screen, inside the same risk limits.",
                             uz: "Bot X-Ray bu versiyani tayyor holda taqdim etmaydi. Buni bot-x-ray papkasida Claude Code’ga joylashtiring va Claude uni xuddi shu xavf chegaralarida Strategiya sahifasida qog‘ozda ishlaydigan plagin sifatida yozadi." },
  'convert.copyPrompt':   { en: 'Copy the prompt',      uz: 'Buyruqni nusxalash' },
  'convert.h2.whereConvert':{ en: 'Where it does convert', uz: 'Qayerda moslashtirsa bo‘ladi' },
  'convert.nowhere':      { en: "Nowhere a broker offers.", uz: 'Broker taklif qiladigan birorta joyda emas.' },
  'convert.lostH2':       { en: "What's lost in the conversion", uz: 'Moslashtirishda nima yo‘qotiladi' },
  'convert.whoDoesBox.title': { en: 'who does the converting', uz: 'kim moslashtiradi' },
  'convert.whoDoesBox.desc':  { en: "Bot X-Ray ships two conversions and runs them on paper: coinman2's \"price it like an option\" loop on ETF option spreads and on Kalshi. Every other conversion on this page is written by Claude, from these rules, as a plug-in in lib/strategy/custom. Nothing trades real money until you connect your own broker and arm it yourself.",
                                 uz: "Bot X-Ray ikkita tayyor moslashtirishni o‘z ichiga oladi va ularni qog‘ozda ishlatadi: coinman2 ning ETF optsion spredlari va Kalshi’dagi \"optsion kabi baholash\" sikli. Ushbu sahifadagi barcha boshqa moslashtirishlar ushbu qoidalar asosida lib/strategy/custom dagi plagin sifatida Claude tomonidan yoziladi. O‘zingiz brokeringizni ulab, qurollantirmaguningizcha hech narsa haqiqiy pul bilan savdo qilmaydi." },
  'convert.foot':         { en: "Numbers in the rules come from {{name}}'s own trades in the x-ray sample. A conversion keeps the idea; the market, the fees, the hours and the speed all change, which is why each one starts on paper.",
                             uz: "Qoidalardagi raqamlar {{name}} ning x-ray namunasidagi o‘z savdolaridan olingan. Moslashtirish asosiy g‘oyani saqlab qoladi; bozor, komissiyalar, vaqt va tezlik o‘zgaradi, shuning uchun har biri qog‘ozda boshlanadi." },
  'convert.copied':       { en: 'Copied', uz: 'Nusxalandi' },
  'convert.selectCopy':   { en: 'Select the text and copy it', uz: 'Matnni tanlang va nusxalang' },

  // ── winning screen ──
  'winning.kicker':       { en: "Who's winning now",  uz: 'Hozir kim yutmoqda' },
  'winning.h1':           { en: "The top crypto earners on Polymarket, what each one does, and whether luck could explain it.",
                             uz: 'Polymarket’da eng ko‘p daromad qilgan kripto savdogarlari, ularning nima qilishi va buni omad bilan tushuntirish mumkinmi.' },
  'winning.sub':          { en: "Each wallet is tagged from its latest trades. Its daily P&L gets the same skill-or-luck check as the x-ray: how often would flipping a coin give that many green days? Click a row to x-ray it.",
                             uz: 'Har bir hamyon oxirgi savdolariga qarab belgilanadi. Uning kunlik F/Z ko‘rsatkichi x-ray kabi mahorat-yoki-omad tekshiruvidan o‘tadi: tanga tashlash qanchalik tez-tez shuncha yashil kun bera oladi? Tekshirish uchun qatorni bosing.' },
  'winning.thisWeek':     { en: 'This week',     uz: 'Bu hafta' },
  'winning.thisMonth':    { en: 'This month',    uz: 'Bu oy' },
  'winning.allTime':      { en: 'All time',      uz: 'Butun davr' },
  'winning.top15':        { en: 'Top 15',        uz: 'Top 15' },
  'winning.top50':        { en: 'Top 50',        uz: 'Top 50' },
  'winning.everyWallet':  { en: 'Every wallet',  uz: 'Barcha hamyonlar' },
  'winning.betterThan':   { en: 'Better than a coin flip', uz: 'Tanga tashlashdan yaxshiroq' },
  'winning.onlyEdges':    { en: "Only edges luck can't explain", uz: 'Faqat omad bilan tushuntirib bo‘lmaydigan ustunliklar' },
  'winning.sortPnl':      { en: 'Sort by P&L',   uz: 'F/Z bo‘yicha saralash' },
  'winning.sortSkill':    { en: 'Sort by least likely to be luck', uz: 'Omad bo‘lishi ehtimoli eng past bo‘yicha' },
  'winning.reading':      { en: 'Reading the leaderboard…',  uz: 'Yetakchilar ro‘yxati o‘qilmoqda…' },
  'winning.th.rank':      { en: '#',             uz: '#' },
  'winning.th.wallet':    { en: 'Wallet',        uz: 'Hamyon' },
  'winning.th.pnl':       { en: 'P&L',           uz: 'F/Z' },
  'winning.th.volume':    { en: 'Traded',         uz: 'Savdo' },
  'winning.th.looksLike': { en: 'Looks like',    uz: 'Nimagadir o‘xshaydi' },
  'winning.th.skillLuck': { en: 'Skill or luck', uz: 'Mahorat yoki omad' },
  'winning.th.greenDays': { en: 'Green days',    uz: 'Yashil kunlar' },
  'winning.th.coinOdds':  { en: 'Coin-flip odds',uz: 'Tanga tashlash ehtimoli' },
  'winning.th.followsBin':{ en: 'Follows Binance', uz: 'Binance’ga ergashadi' },
  'winning.th.feeShare':  { en: 'Fees',          uz: 'Komissiya' },
  'winning.th.profitPerMonth': { en: 'Profit per $ by month', uz: 'Oylar bo‘yicha har $ dan foyda' },
  'winning.refresh':      { en: 'Refresh',       uz: 'Yangilash' },
  'winning.noneFilter':   { en: "None of these {{n}} wallets pass that filter. Try all time, or the top 50.",
                             uz: 'Bu {{n}} ta hamyonning hech biri filtrdan o‘tmadi. Butun davrni yoki eng yaxshi 50 talikni sinab ko‘ring.' },
  'winning.foot':         { en: "From Polymarket's crypto leaderboard (by P&L) and each wallet's public trades. \"Skill or luck\" checks the full trading days of its main run: a real edge means a coin flip would give that many green days less than once in a million tries and the average day is far from zero (t-stat over 4); probably real means less than once in a hundred, or an average day clearly above zero (t-stat over 2.5). Plenty of green days can still come from a strategy that loses big on its red ones, so open the wallet before trusting a label. \"Looks like\" is a guess from a few hours of trades. Follows Binance: of its buys right after Bitcoin moved on Binance, the share on the side of the move (50% is a coin flip). Fees: what it paid as a share of what it traded.",
                             uz: "Polymarket kripto reytingi (F/Z bo‘yicha) va har bir hamyonning ochiq savdolaridan. \"Mahorat yoki omad\" uning asosiy savdo davridagi to‘liq kunlarni tekshiradi: haqiqiy ustunlik — tanga tashlash million urinishda bir martadan kam shuncha yashil kun bera olishini va o‘rtacha kun noldan ancha uzoq ekanligini (t-stat > 4) anglatadi; ehtimol haqiqiy — yuzdan birdan kamroq yoki o‘rtacha kun noldan yuqori (t-stat > 2.5). Qizil kunlarida katta yo‘qotish beradigan strategiya ham ko‘plab yashil kunlarni keltirib chiqarishi mumkin, shuning uchun yorliqqa ishonishdan oldin hamyonni oching. \"Nimagadir o‘xshaydi\" — bir necha soatlik savdolarga asoslangan taxmin. Binance’ga ergashadi: Bitcoin Binance’da harakat qilganidan so‘ng harakat tomonidagi xaridlar ulushi (50% — tanga tashlash). Komissiya: savdo hajmiga nisbatan to‘langan ulush." },

  // ── live gap screen ──
  'live.kicker':          { en: 'Live gap, paper mode',  uz: 'Jonli farq, qog‘oz rejim' },
  'live.h1.watching':     { en: "Watching Bitcoin on Binance and Polymarket's 15‑minute market, every second.",
                             uz: 'Binance’dagi Bitcoin va Polymarket’ning 15 daqiqalik bozori har soniya kuzatilmoqda.' },
  'live.h1.isGap':        { en: 'Is the gap the bots lived on still there? Watch it live.',
                             uz: 'Botlar foydalangan farq hali ham bormi? Jonli kuzating.' },
  'live.sub.intro':       { en: "Once a second this reads Bitcoin on Binance and Polymarket's order book, prices the market the simple way the threads describe, and logs every \"bargain\" that model sees as a $10 paper trade. Nothing is sent to Polymarket.",
                             uz: "Har soniyada bu Binance’dagi Bitcoin va Polymarket buyurtmalar kitobini o‘qiydi, bozorni maqolalarda tasvirlangan oddiy usulda baholaydi va model ko‘rgan har bir \"arzon imkoniyat\"ni $10 lik qog‘oz savdo sifatida qayd etadi. Polymarket’ga hech narsa yuborilmaydi." },
  'live.stop':            { en: 'Stop',               uz: 'To‘xtatish' },
  'live.runsUntil':       { en: 'Runs until',         uz: 'gacha ishlaydi' },
  'live.start20':         { en: 'Start a 20-minute check', uz: '20 daqiqalik tekshiruvni boshlash' },
  'live.busiest':         { en: "Busiest during the US stock market open, when Bitcoin moves most.",
                             uz: 'AQSh fond bozori ochilgan vaqtda, Bitcoin eng ko‘p harakatlanganda eng faol bo‘ladi.' },
  'live.stat.seconds':    { en: 'Seconds watched, {{n}} market{{s}}', uz: 'Kuzatilgan soniyalar, {{n}} ta bozor' },
  'live.stat.bargain':    { en: "Seconds the simple model saw a 'bargain' after fees", uz: "Oddiy model komissiyalardan keyin 'arzon' deb ko‘rgan soniyalar" },
  'live.stat.cheapPair':  { en: 'Cheapest Up + Down, after taker fees', uz: 'Eng arzon Up + Down, teyker komissiyasidan so‘ng' },
  'live.stat.pairUnder1': { en: 'Seconds a pair cost under $1 after fees', uz: 'Komissiyalardan keyin juftlik $1 dan past tushgan soniyalar' },
  'live.stat.volRatio':   { en: "How much more movement the market prices than the model", uz: 'Bozor modelga qaraganda qancha ko‘proq harakatni narxlamoqda' },
  'live.stat.lag':        { en: 'Polymarket vs Binance moves, 0 / 1 / 2 s later', uz: 'Polymarket va Binance harakatlari, 0 / 1 / 2 soniya keyin' },
  'live.h2.paperTrades':  { en: "The model's bargains, as $10 paper trades", uz: 'Modelning arzon imkoniyatlari, $10 lik qog‘oz savdolar sifatida' },
  'live.paper.summary':   { en: '{{settled}} settled: {{won}} won, paper P&L {{pnl}} on {{staked}}.', uz: '{{settled}} ta yakunlandi: {{won}} ta yutdi, {{staked}} ga qog‘oz F/Z: {{pnl}}.' },
  'live.th.time':         { en: 'Time',   uz: 'Vaqt' },
  'live.th.market':       { en: 'Market', uz: 'Bozor' },
  'live.th.side':         { en: 'Side',   uz: 'Tomon' },
  'live.th.paid':         { en: 'Paid',   uz: 'To‘langan' },
  'live.th.fairPrice':    { en: "Model's fair price", uz: 'Modelning adolatli narxi' },
  'live.th.result':       { en: 'Result', uz: 'Natija' },
  'live.foot':            { en: "Fair price: a normal model on Binance's move since the window opened, with Binance's last 1,000 seconds of volatility, the way the X threads describe it. Taker fee: Polymarket's crypto curve, 0.07 × p × (1 − p) a share. When the model sees a bargain most of the time, the model is wrong: real bargains are taken in under a second. The markets settle on Chainlink, not Binance. * Settled on its final price: Polymarket marks a market closed a while after it ends.",
                             uz: "Adolatli narx: oyna ochilganidan buyon Binance harakatiga nisbatan oddiy model, Binance’ning oxirgi 1,000 soniyalik volatilligi bilan, X maqolalarida tasvirlangandek. Teyker komissiyasi: Polymarket’ning kripto grafigi, ulush boshiga 0.07 × p × (1 − p). Model ko‘p vaqt davomida arzon imkoniyat ko‘rsa, demak model noto‘g‘ri: haqiqiy arzon imkoniyatlar bir soniyadan kamroq vaqt ichida olinadi. Bozorlar Binance’da emas, Chainlink’da hisob-kitob qilinadi. * Yakuniy narx bo‘yicha hisob-kitob qilingan: Polymarket bozor tugaganidan bir oz vaqt o‘tgach uni yopiq deb belgilaydi." },
  'live.simpleModel':     { en: 'the simple model', uz: 'oddiy model' },

  // ── strategy screen ──
  'strategy.kicker':      { en: 'Strategy · paper mode',  uz: 'Strategiya · qog‘oz rejim' },
  'strategy.loading':     { en: 'Loading…',               uz: 'Yuklanmoqda…' },
  'strategy.h1':          { en: "The loop that's still running: price it like an option, buy the cheap side, hold to the end.",
                             uz: 'Hali ham ishlab turgan sikl: optsion kabi baholash, arzon tomonni sotib olish, oxirigacha ushlab turish.' },
  'strategy.sub':         { en: "coinman2's loop, converted from Polymarket to markets you can trade: Kalshi's Bitcoin and Ether markets, and option spreads on the Bitcoin and Ether ETFs. Every {{minutes}} minutes it prices each \"above this price by this date\" contract from the live price and how much the coin usually moves, then buys the side priced too low by at least {{edge}}¢ after fees. It only buys sides priced {{lo}}–{{hi}}¢ (coinman2 lost money below 20¢) and skips a market when its own volatility disagrees with the market's by a lot (the trap from the live check). It never sells.",
                             uz: 'coinman2 ning sikli, Polymarket’dan siz savdo qilishingiz mumkin bo‘lgan bozorlarga moslashtirilgan: Kalshi’ning Bitcoin va Ether bozorlari hamda Bitcoin va Ether ETF’laridagi optsion spredlari. Har {{minutes}} daqiqada u jonli narxdan va tanganing odatda qancha harakatlanishidan har bir "ushbu sanagacha ushbu narxdan yuqori" shartnomasini baholaydi, so‘ngra komissiyalardan keyin kamida {{edge}}¢ ga past baholangan tomonni sotib oladi. U faqat {{lo}}–{{hi}}¢ oralig‘idagi tomonlarni sotib oladi (coinman2 20¢ dan pastda pul yo‘qotgan) va o‘zining volatilligi bozor volatilligi bilan sezilarli darajada mos kelmasa, bozorni o‘tkazib yuboradi (jonli tekshiruvdagi tuzoq). U hech qachon sotmaydi.' },
  'strategy.armed':       { en: 'ARMED for live orders until', uz: 'jonli buyurtmalar uchun QUROLLANTIRILGAN, gacha:' },
  'strategy.paper':       { en: 'Paper',            uz: 'Qog‘oz' },
  'strategy.scanEvery':   { en: 'Scanning every {{n}} minutes', uz: 'Har {{n}} daqiqada skanerlash' },
  'strategy.scanNow':     { en: 'Scan now',         uz: 'Hozir skanerlash' },
  'strategy.scanning':    { en: 'Scanning…',   uz: 'Skanerlanmoqda…' },
  'strategy.aTrade':      { en: 'a trade',          uz: 'savdosiga' },
  'strategy.stat.open':   { en: 'Open positions',   uz: 'Ochiq pozitsiyalar' },
  'strategy.stat.atRisk': { en: 'Paper money at risk',  uz: 'Xavf ostidagi qog‘oz pul' },
  'strategy.stat.settled':{ en: 'Settled',           uz: 'Yakunlangan' },
  'strategy.stat.won':    { en: 'Won',               uz: 'Yutilgan' },
  'strategy.stat.pnl':    { en: 'Paper P&L',         uz: 'Qog‘oz F/Z' },
  'strategy.stat.expected':{ en: 'What the model expected on those', uz: 'Model ular bo‘yicha nimani kutgan edi' },
  'strategy.h2.lastScan': { en: 'Last scan',         uz: 'Oxirgi skanerlash' },
  'strategy.markets':     { en: 'markets',           uz: 'bozor' },
  'strategy.contracts':   { en: 'contracts',         uz: 'shartnoma' },
  'strategy.pricedTooLow':{ en: '{{n}} contract{{s}} priced too low by the model', uz: 'Model tomonidan {{n}} ta shartnoma haddan tashqari past baholandi' },
  'strategy.nothingTooLow':{ en: "Nothing priced too low by {{edge}}¢ or more right now. Most scans look like this.",
                              uz: "Hozirda {{edge}}¢ yoki undan ko‘proq past baholangan narsa yo‘q. Aksariyat skanerlashlar shunday ko‘rinadi." },
  'strategy.th.contract': { en: 'Contract',          uz: 'Shartnoma' },
  'strategy.th.where':    { en: 'Where',             uz: 'Qayerda' },
  'strategy.th.closes':   { en: 'Closes',            uz: 'Yopiladi' },
  'strategy.th.buy':      { en: 'Buy',               uz: 'Sotib olish' },
  'strategy.th.costs':    { en: 'Costs, with fees',  uz: 'Xarajat (komissiya bilan)' },
  'strategy.th.fairPrice':{ en: "Model's fair price", uz: 'Modelning adolatli narxi' },
  'strategy.th.edge':     { en: 'Edge',              uz: 'Ustunlik' },
  'strategy.yesAbove':    { en: 'Yes (above)',        uz: 'Ha (yuqorida)' },
  'strategy.noBelow':     { en: 'No (below)',         uz: 'Yo‘q (pastda)' },
  'strategy.etfOptions':  { en: 'ETF options',        uz: 'ETF optsionlari' },
  'strategy.h2.marketsRead': { en: 'Markets read',   uz: 'O‘qilgan bozorlar' },
  'strategy.th.price':    { en: 'Price',              uz: 'Narx' },
  'strategy.th.contractN':{ en: 'Contracts',          uz: 'Shartnomalar' },
  'strategy.th.modelVol': { en: 'Model vol',          uz: 'Model vol' },
  'strategy.th.marketVol':{ en: "Market's vol",       uz: 'Bozor vol' },
  'strategy.th.status':   { en: 'Status',             uz: 'Holat' },
  'strategy.toBuy':       { en: '{{n}} to buy',       uz: '{{n}} ta xaridga' },
  'strategy.skipped':     { en: 'skipped: {{reason}}', uz: 'o‘tkazib yuborildi: {{reason}}' },
  'strategy.modelVolRatio':{ en: "model vol {{ratio}}× the market's", uz: 'model vol bozorga nisbatan {{ratio}}×' },
  'strategy.noMarketVol': { en: 'no market vol',      uz: 'bozor vol yo‘q' },
  'strategy.firstScan':   { en: 'The first scan runs a few seconds after the app starts. Press Scan now to run one.',
                             uz: 'Birinchi skanerlash ilova ishga tushganidan bir necha soniya o‘tib amalga oshiriladi. Skanerlashni o‘tkazish uchun "Hozir skanerlash" tugmasini bosing.' },
  'strategy.h2.plugins':  { en: 'Your plug-ins',      uz: 'Sizning plaginlaringiz' },
  'strategy.plugins.desc':{ en: 'Conversions Claude wrote for your broker (lib/strategy/custom). They run on paper in this same loop, inside the same limits.',
                             uz: 'Claude sizning brokeringiz uchun yozgan moslashtirishlar (lib/strategy/custom). Ular xuddi shu siklda, xuddi shu chegaralar ichida qog‘ozda ishlaydi.' },
  'strategy.plugins.th.plugin':  { en: 'Plug-in',     uz: 'Plagin' },
  'strategy.plugins.th.from':    { en: 'Converted from', uz: 'Qaysi botdan moslashtirilgan' },
  'strategy.plugins.th.for':     { en: 'For',          uz: 'Mo‘ljallangan' },
  'strategy.plugins.th.lastScan':{ en: 'Last scan',    uz: 'Oxirgi skanerlash' },
  'strategy.plugins.off':       { en: 'switched off',  uz: 'o‘chirilgan' },
  'strategy.plugins.none':      { en: "None yet. Every other bot converts on its \"Trade it with a broker\" tab: Claude writes that version here as a plug-in, and it runs on paper next to this one.",
                                    uz: 'Hozircha yo‘q. Har bir boshqa bot "Broker orqali savdo" sahifasida moslashtiriladi: Claude bu versiyani shu yerda plagin sifatida yozadi va u qog‘ozda buning yonida ishlaydi.' },
  'strategy.h2.openPos':  { en: 'Open positions',      uz: 'Ochiq pozitsiyalar' },
  'strategy.th.side':     { en: 'Side',                 uz: 'Tomon' },
  'strategy.th.paid':     { en: 'Paid',                 uz: 'To‘langan' },
  'strategy.th.fairThen': { en: 'Fair then',            uz: 'O‘sha paytdagi adolatli' },
  'strategy.th.stake':    { en: 'Stake',                uz: 'Stavka' },
  'strategy.h2.settled':  { en: 'Settled',              uz: 'Yakunlangan' },
  'strategy.th.paidOut':  { en: 'Paid out',             uz: 'To‘lab berilgan' },
  'strategy.h2.broker':   { en: 'Your broker',          uz: 'Sizning brokeringiz' },
  'strategy.broker.where':{ en: "Where you can trade these: Kalshi's Bitcoin and Ether price markets are for US residents and the other countries Kalshi accepts. The ETF option spreads need an options account with a broker that offers US-listed options where you live. Check what your account allows before you connect it.",
                             uz: 'Bularni qayerda savdo qilishingiz mumkin: Kalshi’ning Bitcoin va Ether narx bozorlari AQSh rezidentlari va Kalshi qabul qiladigan boshqa mamlakatlar uchun. ETF optsion spredlari siz yashaydigan joyda AQShda ro‘yxatga olingan optsionlarni taklif qiladigan brokerda optsion hisobini talab qiladi. Ulanishdan oldin hisobingiz nimalarga ruxsat berishini tekshiring.' },
  'strategy.broker.keys': { en: 'Keys found',           uz: 'Kalitlar topildi' },
  'strategy.broker.yes':  { en: 'yes',                  uz: 'ha' },
  'strategy.broker.no':   { en: 'no',                   uz: 'yo‘q' },
  'strategy.broker.adapter':{ en: 'Adapter',            uz: 'Adapter' },
  'strategy.broker.stopOn':{ en: 'Stop is on',          uz: 'To‘xtatish yoqilgan' },
  'strategy.broker.armNote':{ en: 'Arming happens only in your own terminal, with', uz: 'Qurollantirish faqat o‘zingizning terminalingizda amalga oshiriladi:' },
  'strategy.disarm':      { en: 'Disarm',               uz: 'Qurolsizlantirish' },
  'strategy.stopAll':     { en: 'Stop everything',      uz: 'Barchasini to‘xtatish' },
  'strategy.foot':        { en: "Paper fills are at the quoted ask plus fees: Kalshi's taker fee, or ${{comm}} a contract a leg for options. Option quotes are CBOE's free ones, 15 minutes late, so live fills would differ. Nothing here promises a profit, and the side you buy can go to zero.",
                             uz: 'Qog‘oz ijrolari so‘ralgan ask narxi va komissiyalar bo‘yicha: Kalshi teyker komissiyasi yoki optsionlar uchun oyoq boshiga shartnomaga ${{comm}}. Optsion kotirovkalari — CBOE’ning 15 daqiqa kechikuvchi bepul kotirovkalari, shuning uchun jonli ijrolar farq qiladi. Bu yerdagi hech narsa foyda va’da qilmaydi va siz sotib olgan tomon nolga tushishi mumkin.' },
  'strategy.options':     { en: 'options',              uz: 'optsionlar' },
  'strategy.viewDoc':     { en: 'Read full strategy write-up (Uzbek / English)', uz: 'Strategiyaning to‘liq sharhini o‘qish' },

  // ── claude screen ──
  'claude.kicker':        { en: 'Connect Claude',  uz: 'Claude ulash' },
  'claude.h1':            { en: 'Ask Claude to reverse engineer any wallet, in one sentence.',
                             uz: 'Claude’dan har qanday hamyonni bitta jumlada teskari muhandislik qilishni so‘rang.' },
  'claude.sub':           { en: "Run this once in a terminal and Claude Code can use Bot X-Ray from any chat: the x-ray, the leaderboard, the live check and the paper strategy. It reads the same public data, from your computer.",
                             uz: 'Buni terminalda bir marta ishga tushiring va Claude Code har qanday chatdan Bot X-Ray’dan foydalana oladi: x-ray, yetakchilar ro‘yxati, jonli tekshiruv va qog‘oz strategiya. U xuddi shu ochiq ma’lumotlarni sizning kompyuteringizdan o‘qiydi.' },
  'claude.copy':          { en: 'Copy',             uz: 'Nusxalash' },
  'claude.copied':        { en: 'Copied',           uz: 'Nusxalandi' },
  'claude.selectCopy':    { en: 'Select the line and copy it', uz: 'Qatorni belgilang va nusxalang' },
  'claude.h2.askLike':    { en: 'Then ask things like', uz: 'So‘ng quyidagicha so‘rang' },
  'claude.ex1':           { en: 'Reverse engineer the Polymarket wallet 0x8dxd.', uz: '0x8dxd Polymarket hamyonini teskari muhandislik qil.' },
  'claude.ex2':           { en: 'Was gabagool22 skill or luck?', uz: 'gabagool22 mahorat edimi yoki omad?' },
  'claude.ex3':           { en: "Convert 0x8dxd's strategy so I can trade it on my crypto exchange.", uz: '0x8dxd strategiyasini kripto birjamda savdo qila oladigan qilib moslashtir.' },
  'claude.ex4':           { en: "Who's winning Polymarket's crypto markets this month, and how?", uz: 'Bu oy Polymarket’ning kripto bozorlarida kim yutmoqda va qanday qilib?' },
  'claude.ex5':           { en: 'Run the live gap check for a minute. Is the lag still there?', uz: 'Jonli farq tekshiruvini bir daqiqa ishga tushir. Kechikish hali ham bormi?' },
  'claude.ex6':           { en: 'What is the paper strategy holding, and how has it done?', uz: 'Qog‘oz strategiya nimani ushlab turibdi va natijasi qanday bo‘ldi?' },
  'claude.foot':          { en: 'Using another agent? In the bot-x-ray folder, <code>node scripts/xray.js &lt;wallet or username&gt;</code> prints the same report.',
                             uz: 'Boshqa agentdan foydalanasizmi? bot-x-ray papkasida <code>node scripts/xray.js &lt;hamyon yoki foydalanuvchi nomi&gt;</code> xuddi shu hisobotni chiqaradi.' },
};

let _lang = 'uz';
try { _lang = localStorage.getItem('bx.lang') || 'uz'; } catch { /* private */ }
if (!['en','uz'].includes(_lang)) _lang = 'uz';

export function lang() { return _lang; }
export function setLang(code) {
  _lang = code;
  try { localStorage.setItem('bx.lang', code); } catch {}
  document.documentElement.lang = code;
}
export function t(key, vars) {
  const entry = S[key];
  let s = entry ? (entry[_lang] ?? entry.en ?? key) : key;
  if (vars) for (const [k,v] of Object.entries(vars)) s = s.replaceAll(`{{${k}}}`, v);
  return s;
}

// ── Dates and Months ──
const UZ_MON = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyun', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
const EN_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const UZ_DAYS = ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan'];

export function formatMonth(m) {
  const monIdx = Number(m.slice(5, 7)) - 1;
  const list = _lang === 'uz' ? UZ_MON : EN_MON;
  return `${list[monIdx]} ${m.slice(2, 4)}`;
}

export function formatNiceDate(d) {
  if (!d) return '–';
  const [y, m, dd] = d.split('-').map(Number);
  const list = _lang === 'uz' ? UZ_MON : EN_MON;
  return `${dd} ${list[m - 1]} ${y}`;
}

export function formatCloseTime(t) {
  const dt = new Date(t * 1000);
  if (_lang === 'uz') {
    const dayName = UZ_DAYS[dt.getDay()];
    const mName = UZ_MON[dt.getMonth()];
    const d = dt.getDate();
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    return `${dayName}, ${d}-${mName}, ${hh}:${mm}`;
  }
  return dt.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Strategy tags ──
const TAG_TRANSLATIONS = {
  speed:   { en: 'Speed trade (Binance lag)', uz: 'Tezkor savdo (Binance kechikishi)' },
  pair:    { en: 'Pair trade',                uz: 'Juftlik savdosi (arbitraj)' },
  options: { en: 'Option pricing',            uz: 'Optsion narxlash' },
  levels:  { en: 'Price level arbitrage',     uz: 'Narx darajasi arbitraji' },
  maker:   { en: 'Market maker',              uz: 'Market meyker' },
  updown:  { en: 'Short crypto Up/Down',      uz: 'Qisqa muddatli kripto Up/Down' },
  quiet:   { en: 'No recent trades',          uz: 'So‘nggi paytda savdo yo‘q' },
  sports:  { en: 'Sports',                    uz: 'Sport' },
  other:   { en: 'Other',                     uz: 'Boshqa' },
};

export function translateTag(tag, originalLabel) {
  const entry = TAG_TRANSLATIONS[tag];
  if (entry) return entry[_lang] ?? entry.en ?? originalLabel;
  return originalLabel;
}

// ── Edge labels ──
const EDGE_TRANSLATIONS = {
  edge:     { en: 'a real edge',      uz: 'haqiqiy ustunlik' },
  probably: { en: 'probably real',    uz: 'katta ehtimol bilan haqiqiy' },
  luck:     { en: 'could be luck',    uz: 'omad bo‘lishi mumkin' },
  few:      { en: 'too few days',     uz: 'kunlar juda kam' },
};

export function translateEdge(edge, originalLabel) {
  const entry = EDGE_TRANSLATIONS[edge];
  if (entry) return entry[_lang] ?? entry.en ?? originalLabel;
  return originalLabel;
}

// ── Rule changes labels ──
const RULE_TRANSLATIONS = {
  '5 Jan: taker fees':                 { en: '5 Jan: taker fees',                 uz: '5-yan: teyker komissiyalari' },
  '18 Feb: removed taker delay':       { en: '18 Feb: removed taker delay',       uz: '18-fev: teyker kechikishi olib tashlandi' },
  '30 Mar: steeper crypto fee curve':  { en: '30 Mar: steeper crypto fee curve',  uz: '30-mar: yangi tik kripto komissiya grafigi' },
  '6 May: maker fee rebate':           { en: '6 May: maker fee rebate',           uz: '6-may: meyker komissiyasi chegirmasi' },
};

export function translateRule(rule) {
  const entry = RULE_TRANSLATIONS[rule];
  if (entry) return entry[_lang] ?? entry.en ?? rule;
  return rule;
}

// ── Kinds labels ──
export function translateKind(label) {
  if (_lang !== 'uz') return label;
  return label
    .replace('5- and 15-minute crypto Up or Down', '5 va 15 daqiqalik kripto Up/Down')
    .replace('5/15-min Up or Down', '5/15 daq Up/Down')
    .replace('hourly and daily crypto Up or Down', 'Soatlik va kunlik kripto Up/Down')
    .replace('Hourly/daily Up or Down', 'Soatlik/kunlik Up/Down')
    .replace('crypto price levels', 'Kripto narx darajalari')
    .replace('sports', 'Sport')
    .replace('other', 'Boshqa');
}

// ── Verdicts ──
export function translateLuckVerdict(verdict) {
  if (_lang !== 'uz') return verdict;
  if (!verdict) return verdict;
  if (verdict.includes("Luck can't explain this.")) {
    return verdict.replace("Luck can't explain this.", "Buni omad bilan tushuntirib bo‘lmaydi.");
  }
  if (verdict.includes("Probably a real edge.")) {
    return verdict.replace("Probably a real edge.", "Katta ehtimol bilan haqiqiy ustunlik.");
  }
  if (verdict.includes("Could easily be luck.")) {
    return verdict.replace("Could easily be luck.", "Osonlikcha omad bo‘lishi mumkin.");
  }
  if (verdict.includes("Too few trading days to tell.")) {
    return verdict.replace("Too few trading days to tell.", "Baho berish uchun savdo kunlari juda kam.");
  }
  return verdict;
}

export function translateStill(still) {
  if (_lang !== 'uz') return still;
  if (!still) return still;
  // e.g. "Stopped trading on 25 Mar 2026."
  const stoppedM = still.match(/Stopped trading on (.+?)\./);
  if (stoppedM) {
    return `${stoppedM[1]} sanasida savdoni to‘xtatgan.`;
  }
  if (still.includes("Still trading, but profit per dollar is falling")) {
    return "Hali ham savdo qilmoqda, lekin har dollardan tushadigan foyda pasayib bormoqda.";
  }
  if (still.includes("Still trading.")) {
    return still.replace("Still trading.", "Hali ham savdo qilmoqda.")
      .replace("Down", "Pasayish:")
      .replace("Up", "O‘sish:")
      .replace("since 1", "1-sanadan buyon");
  }
  return still;
}

export function translateVerdict(r) {
  if (_lang !== 'uz') return r.verdict;
  const tag = r.tag;
  const name = r.name;
  if (tag === 'speed') {
    return `${name} — bu tezkor savdo boti. U hech qanday yo‘nalishni bashorat qilmaydi: oldingi 10 soniyada Binance’da kriptovalyuta narxi harakatlanganidan so‘ng, uning xaridlari harakat tomonida bo‘lgan, ya’ni Polymarket narxi yetib olguncha sotib olgan. Komissiyalar va bir soniyadan kam kechikish sababli to‘xtagan.`;
  }
  if (tag === 'pair') {
    return `${name} — bu juftlik savdo (arbitraj) boti. U 15 daqiqalik bozorlarda bir juftlik uchun $1 dan arzon narxda Up va Down tomonlarini birga sotib olgan. Qaysi tomon yutishidan qat’i nazar $1 to‘langan va oradagi farq sof foyda bo‘lgan. Teyker komissiyalari joriy etilgach to‘xtagan.`;
  }
  if (tag === 'options') {
    return `${name} "ushbu sanada narx K dan yuqori bo‘ladimi" bozorlarini optsion kabi narxlaydi: u jonli narxdan va tanganing odatiy harakatidan haqiqiy ehtimollikni hisoblab chiqadi, arzon narxlangan tomonni sotib oladi va oxirigacha ushlab turadi. Hali ham savdo qilmoqda.`;
  }
  if (tag === 'maker') {
    return `${name} asosan kutilayotgan limit buyurtmalarni joylashtiradi va Binance ortidan quvmasdan chegirmalar (rebate) ishlab topadi.`;
  }
  return r.verdict;
}
