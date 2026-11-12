---
name: V70
description: De app van studentenhuis Verbs 70, gelezen als een glanzend bordeaux vertrekbord.
colors:
  bordeaux-gloss: "#8E1B35"
  bordeaux-deep: "#7A1530"
  board-lacquer: "#4A0D1A"
  panel-lacquer: "#3F0B17"
  ground-deep: "#2A0710"
  ground-night: "#1C050B"
  ground-base: "#14040A"
  ivory: "#F4EBDD"
  rose-grey: "#E3C9CF"
  rose-dim: "#B99AA2"
  signal-amber: "#F2C14E"
  home-teal: "#2FB59B"
  home-teal-ink: "#5FD3BA"
  home-teal-deep: "#145A4C"
  home-teal-night: "#06261F"
  home-mint-ink: "#E6F5F0"
  ground-glow: "#9A2140"
  ivory-light: "#FBF4EA"
  sand: "#D9B9A3"
  offline-grey: "#8C7479"
  away-grey: "#5A4549"
  away-ink: "#E6D8DB"
  gloss: "rgba(255,255,255,.13)"
  gloss-bright: "rgba(255,255,255,.22)"
  sheen: "rgba(255,255,255,.15)"
  sheen-soft: "rgba(255,255,255,.1)"
  well: "rgba(10,2,5,.35)"
  shadow: "rgba(0,0,0,.7)"
typography:
  display:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 0.9
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.05
    fontFeature: "tnum"
  headline-small:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.05
  title:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.25
    fontFeature: "tnum"
  section:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.03em"
  display-welcome:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "88px"
    fontWeight: 700
    lineHeight: 0.85
  body:
    fontFamily: "Barlow, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
  body-small:
    fontFamily: "Barlow, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.35
  label:
    fontFamily: "Barlow, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.25
rounded:
  sm: "12px"
  md: "18px"
  lg: "22px"
  nav: "24px"
  pill: "99px"
spacing:
  gutter: "14px"
  gap: "10px"
  panel: "14px"
  board: "16px"
  section: "26px"
components:
  button-primary:
    backgroundColor: "{colors.ivory}"
    textColor: "{colors.board-lacquer}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
    height: "44px"
  button-default:
    backgroundColor: "rgba(244,235,221,.1)"
    textColor: "{colors.ivory}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
    height: "44px"
  board:
    backgroundColor: "{colors.board-lacquer}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.lg}"
    padding: "14px 16px"
  board-row:
    textColor: "{colors.ivory}"
    typography: "{typography.title}"
    padding: "11px 16px"
    height: "46px"
  tile:
    backgroundColor: "{colors.panel-lacquer}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.md}"
    padding: "{spacing.panel}"
  tile-wide:
    backgroundColor: "{colors.bordeaux-gloss}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.md}"
    padding: "{spacing.panel}"
  here-setup:
    backgroundColor: "{colors.home-teal-deep}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
  input:
    backgroundColor: "rgba(10,2,5,.35)"
    textColor: "{colors.ivory}"
    rounded: "{rounded.sm}"
    padding: "11px 13px"
    height: "46px"
  chip-home:
    backgroundColor: "rgba(47,181,155,.2)"
    textColor: "{colors.home-teal-ink}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  nav:
    backgroundColor: "rgba(22,4,9,.8)"
    textColor: "{colors.rose-dim}"
    rounded: "{rounded.nav}"
    height: "66px"
---

# Design System: V70

## Overview

**Creative North Star: "Het vertrekbord van V70"**

V70 leest als het perronbord van het eigen huis: wat er nu en vandaag gebeurt, wie het doet en hoe laat, in een vaste kolomrij van tijd, wat en wie. Het materiaal is glanzend bordeaux lak: diepe panelen met een zachte glans linksboven en een lichtrand langs de bovenkant, op een grond die van glanzend bordeaux naar bijna zwart verloopt. Ivoor is de tekst, amber betekent "nu", zeegroen betekent "thuis".

Het is een werkscherm voor zeventien studenten die kort en vaak kijken. De hiërarchie komt uit schaalcontrast (grote condensed cijfers, kleine labels), niet uit kaders of ornament. Alles staat op één raster met één basislijn per rij vakken; een status verandert kleur, nooit maat. Er is één beweging met betekenis: een regel op het bord klapt om als een splitflap wanneer zijn inhoud verandert.

**Key Characteristics:**
- Glanzend bordeaux als vaste grond en materiaal, nooit als accentje.
- Vertrekbordritme: tijd | wat | wie, tabulaire cijfers.
- Drie belangtreden: nu (amber), straks (ivoor), later (gedimd ivoor).
- Vakken met één grote waarde en één of twee regels context.
- Zwevende tabbalk, profiel via de avatar rechtsboven.

## Colors

Een committed bordeaux-palet: de lak draagt het hele scherm, twee signaalkleuren doen echt werk.

### Primary
- **Glanzend bordeaux** (#8E1B35): het brede roostervak en de glans van de grond; de kleur die "dit is V70" zegt.
- **Diep bordeaux** (#7A1530): vakken en kaarten die extra aandacht vragen (jouw beurt, vandaag), met een amber rand.

### Secondary
- **Signaalamber** (#F2C14E): alles wat nu aandacht vraagt (bordregels "nu", jouw openstaande reactie), sectiekoppen, focusringen, selectie, het actieve tabicoon.

### Tertiary
- **Thuisgroen** (#2FB59B, tekst #5FD3BA, vlak #145A4C): aanwezigheid. Het aantal thuis, de chip "thuis" en de strook "Dit is huis".

### Neutral
- **Bordlak** (#4A0D1A): het vertrekbord.
- **Paneellak** (#3F0B17): vakken, kaarten, de thuisstrook.
- **Grond** (#2A0710 → #1C050B → #14040A): de pagina, in een radiaal verloop vanuit glanzend bordeaux linksboven.
- **Ivoor** (#F4EBDD): alle hoofdtekst en de primaire knop.
- **Rozegrijs** (#E3C9CF): secundaire tekst, labels, metadata.
- **Gedempt roze** (#B99AA2): niet-actieve tabbladen en placeholders.
- **Lakglans** (wit op 13%, 22%, 15% en 10%): glansverloop van panelen, heldere panelen, de diagonale glans van het bord en die van vakken en strook.
- **Gloed** (#9A2140): het lichtste punt van de grond, linksboven.
- **Ivoor-licht en zand** (#FBF4EA naar #D9B9A3): de eigen avatar in de kop.
- **Put** (bijna zwart op 35%): de ondergrond van velden en codeblokken.
- **Afwezig** (#5A4549 met #E6D8DB): avatars van wie weg is; **offline** (#8C7479) voor de verbindingsstip.
- **Groen-op-groen** (#06261F icoon, #E6F5F0 tekst): inhoud op de groene thuisstrook.

### Named Rules
**The Amber Is Now Rule.** Amber staat alleen op iets dat nu aandacht vraagt of een kop is. Nooit als versiering.

**The Teal Means Home Rule.** Groen betekent aanwezig of thuis, en niets anders.

**The Ivory On Lacquer Rule.** Kleine tekst op de lichtste lak (het brede vak, de groene strook) is ivoor, niet rozegrijs; rozegrijs haalt daar geen 4,5:1.

## Typography

**Display Font:** Barlow Semi Condensed (met Barlow, system-ui)
**Body Font:** Barlow (met system-ui, -apple-system, Segoe UI)

**Character:** Een DIN-achtige grotesk uit de wereld van borden en bewegwijzering: compact, technisch en toch vriendelijk. De condensed snit draagt cijfers en tijden, de gewone snit de lopende tekst.

### Hierarchy
- **Display** (700, 40px, regelhoogte 0,9): het woordmerk V70 in de kop; 88px op het welkomstscherm.
- **Headline** (700, 34px, 1,05, tabulair): de ene grote waarde per vak (9/17, 18:30, Keuken).
- **Title** (500, 18px, 1,25, tabulair): regels op het vertrekbord, titels in kaarten (600, 19px).
- **Section** (600, 15px, spatiëring 0,03em, amber): sectiekoppen en de kop van het bord.
- **Body** (400, 16px, 1,45): lopende tekst en formulieren; secundair 14px rozegrijs.
- **Label** (600, 13px): vaktitels en metadata; tabbalk 500, 11px.

### Named Rules
**The Tabular Rule.** Tijden, aantallen en datums staan altijd in tabulaire cijfers, zodat kolommen recht blijven.

**The Scale Contrast Rule.** Hiërarchie komt uit maat en gewicht (34px tegen 13px), niet uit kaders, lijnen of iconen.

## Layout

Eén kolom, maximaal 560px breed en gecentreerd, met 14px zijmarge. Het overzicht stapelt: kop (V70, datum, avatar), het vertrekbord, de thuisstrook, en een raster van vakken in twee kolommen met 10px tussenruimte; het roostervak loopt over de volle breedte. De kop is plakkerig en wordt pas mat (blur) zodra er onder gescrold wordt. De tabbalk zweeft 10px boven de onderrand plus de veilige zone, en de inhoud houdt 108px vrij onderaan. Op desktop blijft het dezelfde kolom op de bordeaux grond. Sectiekoppen hebben 26px ruimte boven en 8px onder.

## Elevation & Depth

Diepte komt uit lak, niet uit zwevende schaduwen. Elk paneel krijgt een verticaal glansverloop, een lichtrand van 1px langs de bovenkant (inset) en, op bord, vakken en thuisstrook, een diagonale glans linksboven. Alleen het bord, de primaire knop, de toast en de tabbalk hebben een echte schaduw.

### Shadow Vocabulary
- **Lichtrand** (`box-shadow: inset 0 1px 0 rgba(255,255,255,.2)`): op elk lakpaneel.
- **Bordlift** (`box-shadow: 0 18px 32px -16px rgba(0,0,0,.7)`): alleen het vertrekbord.
- **Knoplift** (`box-shadow: 0 8px 18px -10px rgba(0,0,0,.7)`): primaire knop.
- **Tabbalk** (`box-shadow: inset 0 1px 0 rgba(255,255,255,.1), 0 14px 30px -8px rgba(0,0,0,.7)`): zwevende navigatie.

### Named Rules
**The Lacquer Rule.** Een paneel is lak: grondkleur, glansverloop en lichtrand. Geen randen of omlijningen om panelen; een amber rand alleen voor "jouw beurt / vandaag".

## Shapes

Zacht afgeronde, stevige vormen: 22px voor het bord, 18px voor vakken en kaarten, 12px voor knoppen en velden, 24px voor de tabbalk, volledig rond voor chips en avatars. Rijen op het bord lopen van rand tot rand, gescheiden door een haarlijn van 12% ivoor. Uitklappers krijgen een amber chevron die een kwartslag draait.

## Components

### Vertrekbord (signature)
Bordlak met lift en diagonale glans. Amber kop "Vandaag in V70", daarna maximaal vier rijen in de kolommen tijd (80px) | wat | wie, gesorteerd op belang: nu (amber), straks (ivoor), later (gedimd). Elke rij is een knop naar het onderdeel. Een rij waarvan de inhoud verandert klapt om (rotateX vanaf -88°, 0,62s, exponentiële ease-out, per rij 90ms vertraging). Leeg: "Rustig in huis. Nog niets gepland vandaag."

### Vakken
- **Vorm:** paneellak, 18px, 14px binnenruimte, minimaal 120px hoog; het roostervak in glanzend bordeaux over de volle breedte.
- **Inhoud:** label (13px) → één grote waarde (34px) met eventueel een kleine eenheid → één of twee regels context; amber voor een openstaande actie.
- **Interactie:** het hele vak is een knop; indrukken schaalt naar 0,97 en licht iets op.

### Thuisstrook
Instelstand in thuisgroen met pin-icoon ("Dit is huis"); daarna paneellak met de eigen zone, een groen (thuis) of amber (in de buurt) pin-vlak en een ververs-icoon.

### Buttons
- **Shape:** 12px, minimaal 44px hoog.
- **Primary:** ivoor met bordlak-tekst, gewicht 600, knoplift.
- **Default:** 10% ivoor met een 1px ivoorrand op 14%.
- **Selected (on):** 24% ivoor met een 1,5px ivoorrand.
- **Ghost:** alleen onderstreepte rozegrijze tekst.
- **Press / Focus:** schaal 0,97; amber focusring van 2px.

### Chips
Volledig rond, 12px/600. Thuis groen op 20% groen, in de buurt en "jij" amber op 16% amber, weg rozegrijs.

### Inputs / Fields
12px, 46px hoog, bijna zwart op 35% met een ivoorrand op 18%; placeholder gedempt roze; focus een amber omlijning van 2px.

### Navigation
Zwevende balk (66px, 24px, donker bordeaux op 80% met blur) met vijf onderdelen: Overzicht, Rooster, Thuis, Uit, Eten. Lijniconen van 23px; actief ivoor label met amber icoon. Profiel via de avatar rechtsboven, Activiteiten via het vak op het overzicht.

### Avatars
Initialen (twee letters) op een vaste toon per persoon uit bordeaux, donkergroen en koper; wie weg is wordt grijs.

## Do's and Don'ts

### Do:
- **Do** houd glanzend bordeaux (#8E1B35 en de lakgrond) de dominante kleur van elk scherm.
- **Do** zet tijden en aantallen in Barlow Semi Condensed met tabulaire cijfers.
- **Do** geef elk nieuw paneel de lak: glansverloop, lichtrand, 18px.
- **Do** gebruik lijniconen (SVG, 1,8–1,9 lijndikte) voor alles wat een icoon nodig heeft.
- **Do** laat alleen bordregels omklappen wanneer hun inhoud verandert, en zet beweging uit bij reduced motion.

### Don't:
- **Don't** gebruik emoji of tekstglyphs als iconen of avatars; profielen zijn initialen of een foto.
- **Don't** gebruik amber of groen als versiering.
- **Don't** zet randen of gekleurde zijstrepen om panelen.
- **Don't** gebruik rozegrijze kleine tekst op het brede bordeaux vak of de groene strook.
- **Don't** herhaal op een vak dezelfde regel die al op het bord staat; toon de aanvullende info (kok, namen).
