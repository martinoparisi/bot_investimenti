# Analisi Mercati

Piattaforma di analisi quantitativa su **FTSE MIB**, **FTSE 100**, **NASDAQ 100** e **S&P 500**.
Calcola con metodi statistici la probabilità che un titolo salga o scenda sull'orizzonte scelto,
mostra grafici aggiornati, classifiche dei titoli migliori e peggiori, consigli Compra / Vendi /
Mantieni e un portafoglio personale con il calcolo delle plusvalenze.

Tutto gratuito: nessuna API a pagamento, nessun account da creare, deploy su Vercel con database
Neon nel piano free.

> **Non è consulenza finanziaria.** Le probabilità sono stime statistiche costruite sui prezzi
> passati. Il passato non determina il futuro.

---

## Indice

1. [Cosa fa](#cosa-fa)
2. [Requisiti](#requisiti)
3. [Avvio in locale](#avvio-in-locale)
4. [Variabili d'ambiente: dove trovare ogni chiave](#variabili-dambiente-dove-trovare-ogni-chiave)
5. [Database Neon](#database-neon)
6. [Deploy su Vercel](#deploy-su-vercel)
7. [Aggiornamento automatico delle classifiche](#aggiornamento-automatico-delle-classifiche)
8. [Come funziona la matematica](#come-funziona-la-matematica)
9. [Struttura del progetto](#struttura-del-progetto)
10. [API interne](#api-interne)
11. [Limiti dichiarati](#limiti-dichiarati)
12. [Manutenzione](#manutenzione)

---

## Cosa fa

### Dashboard (`/`)

- **Top 10 / Sub 10** — i dieci titoli con la probabilità di salita più alta e i dieci con la più
  bassa, filtrabili per indice (FTSE MIB, FTSE 100, NASDAQ 100, S&P 500 o tutti insieme) e per
  periodo di analisi.
- **Mercati seguiti** — la tua watchlist, salvata nel browser. Nessun account, nessun login.
- **Compra / Vendi / Mantieni** — tre colonne con i titoli su cui il modello è più convinto,
  ordinati per forza del segnale.

Indice e periodo finiscono nell'URL (`/?index=ftse-mib&period=3m`), quindi una configurazione
è condivisibile con un link.

### Scheda titolo (`/titolo/[simbolo]`)

- Prezzo corrente con badge **live** o **ritardato**, grafico a candele o ad area
  (TradingView lightweight-charts) con aggiornamento automatico.
- Tabella dei dati sui prezzi: apertura, massimi e minimi, volumi, capitalizzazione, P/E,
  dividend yield, range a 52 settimane, **simbolo** e **ISIN**.
- **Portafoglio ordini**: denaro/lettera con i rispettivi volumi, quando la fonte li espone
  (vedi [Limiti dichiarati](#limiti-dichiarati)).
- Probabilità di salita contro discesa con intervallo di confidenza, contributo di ciascun
  modello e relativo errore misurato fuori campione.
- Percentuali Compra / Vendi / Mantieni.
- Statistiche: volatilità annualizzata, movimento atteso, Sharpe, Sortino, max drawdown,
  VaR e CVaR al 95%, beta contro l'indice di riferimento, asimmetria, curtosi, RSI, MACD,
  bande di Bollinger, distanza dalla media a 200 giorni, ATR, volume relativo, stagionalità
  mensile.

### Il mio conto (`/conto`)

- Registrazione dei movimenti: simbolo, quantità, prezzo di carico, data, commissioni, valuta, note.
- **Plusvalenza dall'acquisto**, per posizione e totale, in valore assoluto e percentuale.
- **Plusvalenza dell'anno fiscale in corso** (anno solare italiano): realizzata sulle posizioni
  chiuse, più la variazione da inizio anno su quelle aperte. Con stima dell'imposta al 26%.
- Probabilità di salita/discesa dell'intero portafoglio, pesata per controvalore.
- Consiglio aggregato Compra / Vendi / Mantieni.
- Esportazione e importazione JSON dei dati (vivono solo nel tuo browser: senza backup si
  perdono cancellando i dati del sito).

### Ricerca

La barra in alto cerca per **ticker**, **nome societario** e anche per **ISIN**
(`IT0000072618` porta a Intesa Sanpaolo).

---

## Requisiti

- **Node.js 20 o superiore** (sviluppato e testato su Node 24)
- npm
- Un account gratuito su [Vercel](https://vercel.com) per il deploy (facoltativo)
- Un account gratuito su [Neon](https://neon.tech) per il database (consigliato, facoltativo)

---

## Avvio in locale

```bash
# 1. Installa le dipendenze
npm install

# 2. Prepara le variabili d'ambiente
#    Il file .env è già presente e funziona anche vuoto.
#    Se manca, crealo copiando l'esempio:
cp .env.example .env

# 3. Avvia
npm run dev
```

Apri <http://localhost:3000>.

**L'app funziona senza nessuna chiave API.** Yahoo Finance, che è la fonte principale, non ne
richiede. Le chiavi opzionali servono solo a migliorare copertura e tempestività.

Altri comandi utili:

```bash
npm test          # test della parte matematica (52 test, nessuna rete)
npm run typecheck # controllo dei tipi TypeScript
npm run build     # build di produzione
npm start         # avvia la build di produzione
npm run constituents  # rigenera le liste dei componenti degli indici
```

---

## Variabili d'ambiente: dove trovare ogni chiave

Le variabili vanno nel file **`.env`** in locale (già presente, in `.gitignore`) e nelle
**Environment Variables** del progetto su Vercel per la produzione. Il file `.env.example`
contiene la stessa lista con le istruzioni ripetute.

> Next.js legge sia `.env` sia `.env.local`. Se preferisci `.env.local`, rinomina il file: il
> comportamento è identico e `.gitignore` copre entrambi.

| Variabile | Serve? | Cosa abilita |
|---|---|---|
| `DATABASE_URL` | consigliata | Classifiche precalcolate che sopravvivono ai riavvii |
| `CRON_SECRET` | sì, se usi il refresh automatico | Protegge l'endpoint di ricalcolo |
| `FINNHUB_API_KEY` | no | Prezzi USA in tempo reale invece che ritardati |
| `TWELVEDATA_API_KEY` | no | Fonte di riserva per le quotazioni |
| `FMP_API_KEY` | no | ISIN dei titoli non presenti nelle liste locali |
| `NEXT_PUBLIC_APP_URL` | no | URL pubblico dell'app |

### `DATABASE_URL` — Neon (gratis)

1. Vai su <https://console.neon.tech> e registrati (bastano GitHub o Google, nessuna carta).
2. **New Project** → scegli una region europea (`eu-central-1`) per avere meno latenza da Vercel EU.
3. Nella dashboard del progetto trovi il riquadro **Connection string**.
4. Seleziona **Pooled connection** e copia l'URL: comincia con
   `postgresql://utente:password@ep-...-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`.
5. Incollalo in `.env` alla riga `DATABASE_URL=`.

Piano free: 0,5 GB di storage, 100 ore-CU al mese, sospensione automatica quando è inattivo.
Ampiamente sufficiente per questa app.

### `CRON_SECRET` — la generi tu

Non è di un servizio esterno: è una password che protegge l'endpoint di ricalcolo.

```bash
openssl rand -hex 32
```

Copia il risultato in `.env` alla riga `CRON_SECRET=`. La stessa stringa va poi messa:

- nelle Environment Variables di Vercel;
- nei **GitHub Secrets** del repository (`Settings` → `Secrets and variables` → `Actions`),
  se usi il workflow di aggiornamento.

### `FINNHUB_API_KEY` — Finnhub (gratis, facoltativa)

1. Registrati su <https://finnhub.io/register> e conferma l'email.
2. Vai su <https://finnhub.io/dashboard>: la chiave è in cima alla pagina, sotto **API Key**.
3. Incollala in `.env` alla riga `FINNHUB_API_KEY=`.

Piano free: 60 chiamate al minuto, prezzi USA in tempo reale, nessuna carta richiesta.
**Senza questa chiave anche i titoli americani restano ritardati di circa 15 minuti.**
La chiave resta sul server e non viene mai esposta al browser.

### `TWELVEDATA_API_KEY` — Twelve Data (gratis, facoltativa)

1. Vai su <https://twelvedata.com/pricing>, scegli il piano **Basic (Free)** e registrati.
2. La chiave è in <https://twelvedata.com/account/api-keys>.
3. Incollala in `.env` alla riga `TWELVEDATA_API_KEY=`.

Piano free: 800 richieste al giorno, 8 al minuto. Copre USA, forex e crypto; **gli indici europei
non sono inclusi nel piano gratuito**, per questo resta una fonte di riserva.

### `FMP_API_KEY` — Financial Modeling Prep (gratis, facoltativa)

1. Registrati su <https://site.financialmodelingprep.com/developer/docs>.
2. La chiave è nella **Dashboard**, sezione **API Keys**.
3. Incollala in `.env` alla riga `FMP_API_KEY=`.

Piano free: 250 richieste al giorno. Serve solo per recuperare l'ISIN dei titoli che non sono
nelle liste locali; una volta trovato viene salvato nel database e non viene più richiesto.
Gli ISIN dei 40 titoli del FTSE MIB sono già inclusi nel progetto.

### `NEXT_PUBLIC_APP_URL`

In locale lascia `http://localhost:3000`. Su Vercel metti il dominio assegnato
(es. `https://analisi-mercati.vercel.app`).

---

## Database Neon

Il database è **opzionale**: senza `DATABASE_URL` l'app funziona con una cache in memoria e le
classifiche vengono ricalcolate dopo ogni riavvio. Con Neon, invece, gli snapshot restano.

Dopo aver creato il progetto Neon, esegui lo schema:

**Opzione A — dal browser**
Apri il **SQL Editor** nella console Neon, incolla il contenuto di `db/schema.sql` ed esegui.

**Opzione B — da terminale**

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

Tabelle create:

| Tabella | Contenuto |
|---|---|
| `instrument` | Anagrafica dei titoli, in particolare gli ISIN già risolti |
| `analysis_snapshot` | Risultato dell'analisi per ogni coppia (titolo, periodo) |
| `ohlc_daily` | Cache facoltativa delle chiusure giornaliere |

---

## Deploy su Vercel

1. Crea un repository su GitHub e caricaci il progetto.
2. Su <https://vercel.com/new> importa il repository. Vercel riconosce Next.js da solo:
   nessuna configurazione di build da toccare.
3. Prima di premere **Deploy**, apri **Environment Variables** e aggiungi almeno:
   - `DATABASE_URL` (dalla console Neon)
   - `CRON_SECRET` (quella generata con `openssl`)
   - le chiavi opzionali che hai deciso di usare
4. **Deploy.**
5. Dopo il primo deploy, aggiorna `NEXT_PUBLIC_APP_URL` con il dominio assegnato e rilancia il
   deploy.

Il file `vercel.json` è già configurato con i cron giornalieri: Vercel li attiva da solo al
deploy, usando `CRON_SECRET` per l'autenticazione.

---

## Aggiornamento automatico delle classifiche

Analizzare 750 titoli richiede più tempo di quello concesso a una singola richiesta HTTP, quindi i
risultati vengono precalcolati e salvati. Ci sono tre meccanismi, complementari:

### 1. GitHub Actions — ogni 30 minuti (consigliato)

Il piano Hobby di Vercel consente cron **una sola volta al giorno**. GitHub Actions no, ed è
gratuito. Il workflow `.github/workflows/refresh.yml` è già pronto:

1. Vai su `Settings` → `Secrets and variables` → `Actions` del tuo repository.
2. Aggiungi due secret:
   - `APP_URL` → l'URL della tua app su Vercel, senza barra finale
   - `CRON_SECRET` → la stessa stringa messa su Vercel
3. Il workflow parte da solo ogni 30 minuti nei giorni feriali, dalle 07:00 alle 22:30 UTC.
   Puoi lanciarlo a mano dalla scheda **Actions** con **Run workflow**, scegliendo il periodo.

### 2. Cron di Vercel — una volta al giorno

Già configurato in `vercel.json` come rete di sicurezza: sette esecuzioni notturne che coprono i
quattro indici.

### 3. Ricalcolo pigro dalla dashboard

Quando apri la dashboard, i titoli con snapshot più vecchio di 30 minuti vengono ricalcolati a
piccoli lotti: la barra di avanzamento in alto mostra quanti titoli mancano e la pagina si
completa da sola. È il motivo per cui la prima apertura, su un database vuoto, si riempie
progressivamente invece di restare bianca.

### Ricalcolo manuale

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/refresh?index=ftse-mib&period=1m"
```

---

## Come funziona la matematica

Tutto il calcolo vive in `lib/analytics/`, senza dipendenze esterne, ed è coperto da test
(`npm test`).

### Periodi e orizzonte

Ogni periodo selezionabile (`1d`, `1w`, `1m`, `3m`, `6m`, `YTD`, `1y`, `3y`, `5y`, `tutto`) fa due
cose distinte:

- decide **cosa mostra il grafico** (intervallo delle barre e ampiezza);
- decide **l'orizzonte della previsione**: la probabilità si riferisce ai prossimi *N* giorni di
  borsa, con *N* pari all'ampiezza del periodo scelto.

L'analisi statistica usa sempre una finestra storica più lunga del periodo mostrato: stimare
volatilità e tendenza su cinque barre non ha senso.

### Probabilità di salita

Tre stimatori indipendenti, ognuno con un difetto diverso:

**1. Frequenza storica (empirico).**
Conta su quante finestre di ampiezza *N* il prezzo è salito. Nessuna assunzione sulla forma della
distribuzione, ma ignora completamente la situazione attuale. L'incertezza si calcola con
l'**intervallo di Wilson** sul numero di finestre *indipendenti* (non sovrapposte): con un
orizzonte di tre mesi e due anni di storia le osservazioni davvero indipendenti sono circa otto,
non cinquecento, e fingere il contrario produrrebbe una precisione inventata.

**2. Modello parametrico GBM.**
Sotto moto browniano geometrico:

```
P(salita) = Φ( (μ − σ²/2) · h / (σ · √h) )
```

- `σ` è stimata con **EWMA λ = 0,94** (RiskMetrics): pesa di più il passato recente e coglie i
  cambi di regime molto prima di una deviazione standard su finestra fissa.
- `μ` è **contratta verso zero** con fattore `n / (n + 252)`. Il motivo è concreto: l'errore
  standard della media è `σ/√n`, e con volatilità giornaliera dell'1,5% servirebbero decenni per
  distinguere una tendenza reale dal rumore. Senza questa contrazione la probabilità seguirebbe
  il rumore del campione.
- L'incertezza si ottiene con il metodo delta: `sd(z) = √(h/n)`.

**3. Regressione logistica sul momentum.**
Sette caratteristiche calcolate solo con dati passati (RSI 14, istogramma MACD, distanza da SMA 50
e SMA 200, momentum a 20 giorni, regime di volatilità, posizione nel range a 52 settimane).
L'etichetta è "il prezzo fra *N* giorni sarà più alto di oggi". Addestramento con discesa del
gradiente e regolarizzazione L2.

### Combinazione

I tre modelli vengono validati **walk-forward**: si allena sui dati fino a un certo punto e si
misura l'errore su quelli successivi, mai visti. Come metrica si usa il **Brier score** (errore
quadratico medio delle previsioni probabilistiche). Il peso di ciascun modello è proporzionale a
`1 / Brier`: chi ha sbagliato meno *su quel titolo* conta di più. La scheda del titolo mostra
pesi ed errori, quindi la combinazione è ispezionabile e non una scatola nera.

L'intervallo di confidenza finale somma due fonti di incertezza:

- l'errore di stima di ogni modello (Wilson per l'empirico, metodo delta per gli altri due);
- il **disaccordo fra i modelli**: se uno dice 80% e un altro 38%, quella distanza è incertezza
  vera e viene aggiunta all'intervallo invece di essere nascosta dalla media.

### Compra / Vendi / Mantieni

Tre utilità trasformate in percentuali con una softmax, quindi la somma fa esattamente 100.

- **Compra** cresce con la probabilità di salita, con il rendimento atteso per unità di rischio,
  con il trend e con le condizioni di ipervenduto.
- **Vendi** cresce con la probabilità di discesa, con il rischio di coda (CVaR), con il drawdown
  storico e con le condizioni di ipercomprato.
- **Mantieni** cresce quando l'affidabilità della stima è bassa.

L'ultimo punto è la parte importante: quando i dati non parlano chiaro, il consiglio prevalente
diventa "non muoverti", invece di dare un segnale netto costruito sul nulla.

### Altre statistiche

Volatilità annualizzata, Sharpe, Sortino, max drawdown, VaR e CVaR storici al 95%, asimmetria,
curtosi in eccesso, beta contro l'indice di riferimento (con le due serie **allineate per data**,
non per posizione: una singola seduta di sfasamento azzererebbe la correlazione), RSI, MACD,
bande di Bollinger, ATR, volume relativo, stagionalità mensile.

---

## Struttura del progetto

```
app/
  layout.tsx                    intestazione con barra di ricerca globale
  page.tsx                      dashboard
  titolo/[symbol]/page.tsx      scheda del titolo
  conto/page.tsx                portafoglio personale
  api/
    search/                     ricerca per ticker, nome o ISIN
    quote/                      quotazioni in blocco
    chart/                      serie per il grafico
    analisi/[symbol]/           analisi completa di un titolo
    classifiche/                dati della dashboard
    cron/refresh/               ricalcolo protetto da CRON_SECRET
components/                     interfaccia (grafico, selettori, tabelle)
lib/
  analytics/                    la matematica, senza dipendenze e testata
    periods.ts                  periodi, orizzonti, finestre storiche
    indicators.ts               RSI, MACD, medie, Bollinger, ATR, OBV
    returns.ts                  rendimenti, volatilità, drawdown, VaR, beta
    probability.ts              i tre stimatori, la combinazione, gli intervalli
    signal.ts                   compra / vendi / mantieni
  data/                         fonti dati (Yahoo, Finnhub, ISIN, universo, book)
  analysis.ts                   orchestratore: dati + matematica
  rankings.ts                   classifiche e ricalcolo pigro
  db.ts                         Neon, con degrado su cache in memoria
  storage.ts                    watchlist e portafoglio in localStorage
data/constituents/*.json        componenti dei quattro indici
scripts/build-constituents.ts   rigenera le liste da Wikipedia
db/schema.sql                   schema Postgres
```

---

## API interne

| Endpoint | Descrizione |
|---|---|
| `GET /api/search?q=` | Ricerca per ticker, nome o ISIN |
| `GET /api/quote?symbols=A,B` | Quotazioni, fino a 100 simboli |
| `GET /api/chart?symbol=&period=` | Serie storica per il grafico |
| `GET /api/analisi/[symbol]?period=` | Analisi completa, book e ISIN |
| `GET /api/classifiche?index=&period=` | Dati della dashboard |
| `GET /api/cron/refresh?index=&period=&offset=&limit=` | Ricalcolo (richiede `Authorization: Bearer $CRON_SECRET`) |

---

## Limiti dichiarati

Preferisco dirli qui che lasciarli scoprire per caso.

**Il book non è disponibile oltre il primo livello.**
Nessuna fonte gratuita espone la profondità del portafoglio ordini di Borsa Italiana o del London
Stock Exchange. L'app mostra denaro e lettera reali quando la fonte li fornisce, e scrive `n/d`
quando non li ha. **Non vengono generati livelli stimati o simulati**: un book inventato sembra
vero e porta a decisioni sbagliate. Per i titoli USA i volumi di denaro e lettera ci sono; per i
titoli italiani di norma arrivano solo i prezzi.

**I prezzi europei sono ritardati di circa 15 minuti.**
È il dato che Yahoo distribuisce gratuitamente. Il badge accanto al prezzo dice sempre se il dato
è *live* o *ritardato*. Con una chiave Finnhub i titoli USA diventano in tempo reale; per Milano e
Londra non esiste una fonte gratuita in tempo reale.

**L'ISIN non è sempre disponibile.**
Yahoo non lo espone. Per i 40 titoli del FTSE MIB è incluso nel progetto; per gli altri serve la
chiave FMP, altrimenti compare `n/d`.

**Le classifiche non sono istantanee al primo avvio.**
Con il database vuoto la dashboard si riempie progressivamente. Dopo il primo ciclo di
aggiornamento è immediata.

**Yahoo Finance è una fonte non ufficiale.**
Non esiste un'API pubblica supportata: gli endpoint potrebbero cambiare senza preavviso. È il
prezzo del "tutto gratuito", ed è il motivo per cui il codice mantiene fonti alternative
configurabili.

**Il calcolo fiscale è indicativo.**
La plusvalenza dell'anno in corso considera, per le posizioni aperte prima del 1° gennaio, la
prima chiusura dell'anno come base. L'imposta è stimata al 26% sulle sole plusvalenze realizzate.
Non tiene conto di minusvalenze pregresse, regime amministrato o dichiarativo, cambi valuta né
altre voci: fa fede la documentazione del tuo intermediario.

---

## Manutenzione

**Liste degli indici.** Cambiano poche volte l'anno. Per aggiornarle:

```bash
npm run constituents
```

Lo script rilegge le tabelle di Wikipedia e riscrive `data/constituents/*.json`. Va lanciato a
mano e i file vanno ricommittati: dipendere da Wikipedia a ogni build sarebbe fragile senza
alcun vantaggio.

**Test.** La parte matematica è coperta da 52 test che non toccano la rete:

```bash
npm test
```

Comprendono la verifica su serie sintetiche a parametri noti (una serie generata con drift e
volatilità noti deve restituire la probabilità analitica attesa), il controllo che le percentuali
Compra/Vendi/Mantieni sommino sempre a 100 su duemila input casuali, e la copertura
dell'intervallo di Wilson su simulazioni ripetute.
