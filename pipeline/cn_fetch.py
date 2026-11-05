# 陸股（A 股）每日資料：BaoStock（免費、不用註冊，給程式用的 A 股資料庫）
#   收錄：滬深 300＋中證 500（約 800 檔大中型股）
#   輸出 pipeline/cache/cn_raw.json，接著由 global.js 產生 App 要的檔案
#   第一次抓 2 年日 K（約 3～5 分鐘），之後每次只補最近幾天
# 用法：python pipeline/cn_fetch.py
import json, os, sys, time, datetime, socket
import baostock as bs

socket.setdefaulttimeout(40)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'cache', 'cn_raw.json')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
FIELDS = 'date,open,high,low,close,volume,amount,turn,pctChg,peTTM,pbMRQ,tradestatus,isST'
INDEX = [('sh.000001', '上證指數'), ('sz.399001', '深證成指'), ('sz.399006', '創業板指'), ('sh.000300', '滬深300')]


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def rows(rs):
    out = []
    while rs.error_code == '0' and rs.next():
        out.append(rs.get_row_data())
    return out


def f(x):
    try:
        return float(x)
    except Exception:
        return None


def kline(code, start, end, fields=FIELDS):
    for i in range(3):
        try:
            rs = bs.query_history_k_data_plus(code, fields, start_date=start, end_date=end, frequency='d', adjustflag='2')
            if rs.error_code == '0':
                return rows(rs)
            log('  錯誤', code, rs.error_msg)
        except Exception as e:
            log('  連線錯誤', code, e)
            time.sleep(3)
            bs.login()
    return []


def main():
    today = (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).date()
    end = today.isoformat()
    try:
        old = json.load(open(OUT, encoding='utf-8'))
    except Exception:
        old = {'stocks': {}}
    lg = bs.login()
    if lg.error_code != '0':
        sys.exit('BaoStock 登入失敗：' + lg.error_msg)

    # 成分股（一週更新一次）
    members = old.get('members')
    if not members or old.get('membersAt', '') < (today - datetime.timedelta(days=7)).isoformat():
        members = {}
        for q, tag in ((bs.query_hs300_stocks, 'hs300'), (bs.query_zz500_stocks, 'zz500')):
            try:
                for r in rows(q()):
                    members[r[1]] = {'n': r[2], 'tag': tag}
            except Exception as e:
                log('成分股失敗', tag, e)
        ind = {}
        try:
            for r in rows(bs.query_stock_industry()):
                ind[r[1]] = r[3]
        except Exception as e:
            log('產業分類失敗', e)
        for c, m in members.items():
            m['ind'] = ind.get(c, '')
        if len(members) < 250:
            members = old.get('members') or members
        else:
            old['membersAt'] = end
    log('成分股', len(members), '檔')

    # 指數：近 1 年
    idx = []
    for code, name in INDEX:
        r = kline(code, (today - datetime.timedelta(days=370)).isoformat(), end, 'date,close,pctChg,amount')
        idx.append({'code': code, 'name': name, 'k': [[x[0], f(x[1]), f(x[2]), f(x[3])] for x in r if f(x[1])]})
    last = idx[0]['k'][-1][0] if idx[0]['k'] else None
    log('上證指數最新日期', last)

    # 個股日 K：有快取就只補最近 10 天
    stocks = old.get('stocks', {})
    t0 = time.time()
    for i, (code, m) in enumerate(members.items()):
        s = stocks.get(code) or {'k': []}
        start = (today - datetime.timedelta(days=730)).isoformat()
        if s['k'] and s.get('adj') == 2:
            start = (datetime.date.fromisoformat(s['k'][-1][0]) - datetime.timedelta(days=10)).isoformat()
        new = [[x[0], f(x[1]), f(x[2]), f(x[3]), f(x[4]), f(x[5]), f(x[6]), f(x[7]), f(x[8]), f(x[9]), f(x[10]), x[11], x[12]] for x in kline(code, start, end)]
        new = [x for x in new if x[4]]
        if s['k'] and new:
            # 前復權：除權息後整段歷史價格會變 → 重疊那天價格對不上就整段重抓
            ov = {x[0]: x[4] for x in s['k'][-15:]}
            same = [abs(ov[x[0]] - x[4]) < 0.011 for x in new if x[0] in ov]
            if same and not all(same):
                new = [[x[0], f(x[1]), f(x[2]), f(x[3]), f(x[4]), f(x[5]), f(x[6]), f(x[7]), f(x[8]), f(x[9]), f(x[10]), x[11], x[12]] for x in kline(code, (today - datetime.timedelta(days=730)).isoformat(), end)]
                s['k'] = []
        keep = [x for x in s['k'] if not new or x[0] < new[0][0]]
        s['k'] = (keep + new)[-500:]
        s['adj'] = 2
        s['n'] = m['n']
        s['ind'] = m.get('ind', '')
        s['tag'] = m.get('tag', '')
        stocks[code] = s
        if (i + 1) % 100 == 0:
            log(f'{i + 1}/{len(members)}（{time.time() - t0:.0f} 秒）')
    for c in list(stocks):
        if c not in members:
            del stocks[c]
    bs.logout()
    out = {'date': last, 'fetched': end, 'members': members, 'membersAt': old.get('membersAt', end), 'index': idx,
           'cols': ['date', 'open', 'high', 'low', 'close', 'vol', 'amt', 'turn', 'pct', 'pe', 'pb', 'status', 'st'], 'stocks': stocks}
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    log('完成', len(stocks), '檔，資料日期', last)


if __name__ == '__main__':
    main()
