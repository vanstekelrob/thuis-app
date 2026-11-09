# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

De 17 bewoners van studentenhuis Verbs 70 (V70). Ze gebruiken de app op hun telefoon, kort en vaak: in de gang, in de keuken, onderweg naar huis. Eén bewoner is beheerder: maakt het huis aan, nodigt uit en vult het schoonmaakrooster in.

## Product Purpose

Eén plek voor het huisleven van V70: wie is er thuis, wie heeft welke schoonmaaktaak, wie gaat er uit, wat gebeurt er in huis en wie eet er mee. Succes: huisgenoten openen de app uit zichzelf, zien op de homepage in één blik wat er speelt, en hebben de groepsapp er minder voor nodig.

## Positioning

Geen huisgenoten-app voor elk huis, maar de eigen app van één huis. Naam, kleur en toon gaan over V70 en deze 17 mensen; een andere app kan dat niet overnemen.

## Operating Context

- PWA op GitHub Pages, op het beginscherm gezet (iPhone en Android); pushmeldingen via Web Push.
- Data in Supabase met Row Level Security; huisgenoten loggen anoniem in en sluiten aan via een uitnodigingslink.
- De app-URL en de repository zijn openbaar.
- Gebruik is kort: de homepage is een overzicht dat in seconden gelezen wordt.

## Capabilities and Constraints

- Onderdelen (tabbladen): schoonmaakrooster, wie is thuis, uit, activiteiten, eten, profiel/instellingen.
- Homepage: overzicht met per onderdeel een klikbaar vak met de belangrijkste info. Welke info per vak komt, wordt later per onderdeel bepaald.
- Schoonmaakrooster: de beheerder vult het handmatig in (nog te bouwen; de huidige code rekent een rotatie uit).
- Eén huis: geen "nieuw huis starten" voor anderen. Toegang via uitnodigingslink met geheime code.
- Profiel: naam en profielfoto, geen emoji. Profielfoto's zijn nog te bouwen.
- Thuis-status. Wens: automatisch herkennen als iemand thuiskomt, per persoon opt-in, zichtbaar voor de anderen, ook als de app dicht is. Beperking: een web-app kan niet op de achtergrond locatie volgen. Huidige route: knop "Dit is huis" (thuispunt per toestel; coördinaten blijven op het toestel), check bij openen, en voor detectie op de achtergrond een automation per persoon (iPhone Opdrachten "Bij aankomst/vertrek", Android-automation-app) die de persoonlijke token-URL aanroept. Gedeeld wordt alleen de zone (thuis / in de buurt / weg), nooit coördinaten. Open beslissing: een native app (kost geld, app-distributie) is niet gekozen.
- Altijd gratis: GitHub Pages, Supabase free tier, GitHub Actions.

## Brand Commitments

- Naam: V70 op icoon en als logo; Verbs 70 als volledige naam.
- Kleur (bindend): glanzend bordeauxrood als vaste app-kleur, met complementaire kleuren.
- Stijl (bindend): voelt als een hypermoderne app, niet als een goedkope website.
- Toon: studentenhuis; informeel, kort, Nederlands.

## Evidence on Hand

- Geen logo, foto's of illustraties. De iconen in `app/icons/` zijn placeholders van de oude "Thuis"-versie.
- Nog geen echte huisdata (0 leden). Voorbeeldinhoud moet als voorbeeld herkenbaar blijven; geen verzonnen namen als echte bewoners presenteren.

## Product Principles

- In één blik: de homepage beantwoordt "wat moet ik nu weten over het huis?" zonder door te klikken.
- Van dit huis: niets generieks, alles over V70.
- Privacy eerst: zone delen, nooit coördinaten; elke locatiefunctie is opt-in per persoon.
- Eén tik per handeling: 17 mensen gebruiken het zonder uitleg.
