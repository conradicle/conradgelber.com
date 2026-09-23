// The curated place list for /play/. Coordinates are never typed here: each
// entry names a feature in Natural Earth's ne_10m_populated_places_simple
// (public domain), and build-places.mjs looks the point up.
//
// Entry format: "Display name=NE name|NE adm0name|NE adm1name"
//   - "=NE name" when the entry's name is not how Natural Earth spells it.
//     The page shows Natural Earth's NAME field, diacritics included, unless
//     the display name is a real rename (Astana for Nur-Sultan); an entry
//     like "Lome=Lomé" displays as Lomé.
//   - A trailing "!" on the display name shows it exactly as written, even
//     when it only differs from Natural Earth by accents ("Osaka!" over Ōsaka).
//   - "|NE adm1name" only when name + country is ambiguous.

export const COUNTRY_LABELS = {
  'United States of America': 'United States',
  'Congo (Kinshasa)': 'Democratic Republic of the Congo',
  'Congo (Brazzaville)': 'Republic of the Congo',
  'Guinea Bissau': 'Guinea-Bissau',
  'The Gambia': 'Gambia',
  'eSwatini': 'Eswatini',
  'East Timor': 'Timor-Leste',
  'Svalbard and Jan Mayen Islands': 'Svalbard, Norway',
};

export const TIERS = {
  capitals: [
    'Asmara|Eritrea', 'Dushanbe|Tajikistan', 'Ulaanbaatar|Mongolia',
    'Paramaribo|Suriname', 'Ouagadougou|Burkina Faso', 'Vientiane|Laos',
    'Bishkek|Kyrgyzstan', 'Nouakchott|Mauritania', 'Ashgabat|Turkmenistan',
    'Tashkent|Uzbekistan', 'Astana=Nur-Sultan|Kazakhstan', 'Thimphu|Bhutan',
    'Kathmandu|Nepal', 'Naypyidaw|Myanmar', 'Phnom Penh|Cambodia',
    'Dili|East Timor', 'Port Moresby|Papua New Guinea', 'Honiara|Solomon Islands',
    'Port Vila|Vanuatu', 'Suva|Fiji', 'Apia|Samoa', 'Wellington|New Zealand',
    'Canberra|Australia', 'Bamako|Mali', 'Niamey|Niger|Niamey', "N'Djamena|Chad",
    'Bangui|Central African Republic', 'Malabo|Equatorial Guinea',
    'Libreville|Gabon', 'Brazzaville|Congo (Brazzaville)', 'Kinshasa|Congo (Kinshasa)',
    'Luanda|Angola', 'Windhoek|Namibia', 'Gaborone|Botswana', 'Maseru|Lesotho',
    'Mbabane|eSwatini', 'Maputo|Mozambique', 'Lilongwe|Malawi', 'Lusaka|Zambia',
    'Harare|Zimbabwe', 'Antananarivo|Madagascar', 'Kigali|Rwanda',
    'Bujumbura|Burundi', 'Kampala|Uganda', 'Nairobi|Kenya', 'Addis Ababa|Ethiopia',
    'Djibouti|Djibouti', 'Mogadishu|Somalia', 'Khartoum|Sudan', 'Conakry|Guinea',
    'Freetown|Sierra Leone', 'Monrovia|Liberia', 'Bissau|Guinea Bissau',
    'Banjul|The Gambia', 'Dakar|Senegal', 'Yamoussoukro|Ivory Coast',
    'Accra|Ghana', 'Lome=Lomé|Togo', 'Porto-Novo|Benin', 'Abuja|Nigeria',
    'Yaounde=Yaoundé|Cameroon', 'Tripoli|Libya', 'Tunis|Tunisia',
    'Rabat|Morocco', 'Algiers|Algeria', 'Sanaa|Yemen', 'Muscat|Oman',
    'Riyadh|Saudi Arabia', 'Amman|Jordan', 'Baku|Azerbaijan', 'Yerevan|Armenia',
    'Tbilisi|Georgia', 'Chisinau=Chișinău|Moldova', 'Skopje|North Macedonia',
    'Podgorica|Montenegro', 'Tirana|Albania', 'Pristina|Kosovo',
    'Sarajevo|Bosnia and Herzegovina', 'Ljubljana|Slovenia', 'Bratislava|Slovakia',
    'Vilnius|Lithuania', 'Riga|Latvia', 'Tallinn|Estonia', 'Minsk|Belarus',
    'Reykjavik=Reykjavík|Iceland', 'Belmopan|Belize', 'Tegucigalpa|Honduras',
    'Managua|Nicaragua', 'San Jose=San José|Costa Rica', 'Georgetown|Guyana',
    'Quito|Ecuador', 'La Paz|Bolivia', 'Asuncion=Asunción|Paraguay',
    'Montevideo|Uruguay', 'Brasilia=Brasília|Brazil', 'Ottawa|Canada',
    'Islamabad|Pakistan', 'Colombo|Sri Lanka',
  ],

  second: [
    'Lagos|Nigeria', 'Karachi|Pakistan', 'Chittagong=Chattogram|Bangladesh',
    'Guayaquil|Ecuador', 'Almaty|Kazakhstan', 'Surabaya|Indonesia',
    'Mombasa|Kenya', 'Porto Alegre|Brazil', 'Kano|Nigeria', 'Ibadan|Nigeria',
    'Kumasi|Ghana', 'Douala|Cameroon', 'Lubumbashi|Congo (Kinshasa)',
    'Johannesburg|South Africa', 'Durban|South Africa', 'Bulawayo|Zimbabwe',
    'Casablanca|Morocco', 'Alexandria|Egypt', 'Oran|Algeria', 'Benghazi=Banghazi|Libya',
    'Port Sudan|Sudan', 'Dire Dawa|Ethiopia', 'Beira|Mozambique',
    'Istanbul|Turkey', 'Izmir!|Turkey', 'Tabriz|Iran', 'Mashhad|Iran',
    'Isfahan|Iran', 'Jeddah|Saudi Arabia', 'Dubai|United Arab Emirates',
    'Basra|Iraq', 'Aleppo|Syria', 'Lahore|Pakistan', 'Peshawar|Pakistan',
    'Mumbai|India', 'Kolkata|India', 'Chennai|India', 'Bangalore=Bengaluru|India',
    'Ahmedabad|India', 'Ho Chi Minh City|Vietnam', 'Mandalay|Myanmar',
    'Chiang Mai|Thailand', 'Cebu|Philippines', 'Davao|Philippines',
    'Medan|Indonesia', 'Makassar|Indonesia', 'Osaka!|Japan', 'Sapporo|Japan',
    'Busan|South Korea', 'Shanghai|China', 'Guangzhou|China', 'Chengdu|China',
    'Harbin|China', 'Urumqi=Ürümqi|China', 'Samarkand|Uzbekistan',
    'Saint Petersburg=St. Petersburg|Russia', 'Novosibirsk|Russia',
    'Yekaterinburg|Russia', 'Vladivostok|Russia', 'Kharkiv|Ukraine',
    'Odesa=Odessa|Ukraine', 'Krakow=Kraków|Poland', 'Gothenburg=Göteborg|Sweden',
    'Milan|Italy', 'Barcelona|Spain', 'Munich|Germany', 'Hamburg|Germany',
    'Marseille|France', 'Sydney|Australia', 'Perth|Australia', 'Auckland|New Zealand',
    'Toronto|Canada', 'Vancouver|Canada', 'Chicago|United States of America',
    'Houston|United States of America', 'Los Angeles|United States of America',
    'Guadalajara|Mexico', 'Monterrey|Mexico', 'Medellin=Medellín|Colombia',
    'Cali|Colombia', 'Arequipa|Peru', 'Santa Cruz|Bolivia',
    'Cordoba=Córdoba|Argentina', 'Rosario|Argentina', 'Valparaiso=Valparaíso|Chile',
    'Sao Paulo=São Paulo|Brazil', 'Rio de Janeiro|Brazil', 'Salvador|Brazil',
    'Recife|Brazil', 'Manaus|Brazil', 'Belo Horizonte|Brazil',
  ],

  edge: [
    'Norilsk|Russia', 'Iquitos|Peru', 'Ushuaia|Argentina', 'Longyearbyen|Svalbard and Jan Mayen Islands',
    'Alice Springs|Australia', 'Timbuktu|Mali', 'Nuuk|Greenland',
    'Kiruna|Sweden', 'Tamanrasset|Algeria', 'Punta Arenas|Chile',
    'Yakutsk|Russia', 'Magadan|Russia', 'Anadyr|Russia', 'Tiksi|Russia',
    'Murmansk|Russia', 'Vorkuta|Russia', 'Dikson|Russia', 'Khatanga|Russia',
    'Pevek|Russia', 'Verkhoyansk|Russia', 'Salekhard|Russia', 'Naryan-Mar=Naryan Mar|Russia',
    'Petropavlovsk-Kamchatsky=Petropavlovsk Kamchatskiy|Russia',
    'Utqiagvik=Utqiaġvik|United States of America', 'Nome|United States of America',
    'Fairbanks|United States of America', 'Iqaluit|Canada', 'Yellowknife|Canada',
    'Whitehorse|Canada', 'Inuvik|Canada', 'Churchill|Canada',
    'Qaanaaq|Greenland', 'Tasiilaq|Greenland', 'Upernavik|Greenland',
    'Ittoqqortoormiit|Greenland', 'Tromso=Tromsø|Norway', 'Hammerfest|Norway',
    'Torshavn=Tórshavn|Faroe Islands', 'Stanley|Falkland Islands',
    'Coyhaique=Coihaique|Chile', 'Kuujjuaq|Canada', 'Cambridge Bay|Canada', 'Rio Gallegos=Río Gallegos|Argentina',
    'Puerto Williams|Chile', 'Leticia|Colombia', 'Cobija|Bolivia',
    'Puerto Maldonado|Peru', 'Agadez|Niger', 'Faya-Largeau=Faya Largeau|Chad',
    'Kufra=Al Jawf|Libya', 'Tindouf|Algeria', 'Djanet|Algeria', 'In Salah=I-n-Salah|Algeria',
    'Atar|Mauritania', 'Walvis Bay|Namibia', 'Luderitz=Lüderitz|Namibia',
    'Maun|Botswana', 'Salalah|Oman', 'Leh|India', 'Lhasa|China', 'Kashgar|China',
    'Golmud|China', 'Gilgit|Pakistan', 'Ilulissat|Greenland', 'Rankin Inlet|Canada',
    'Broome|Australia', 'Tennant Creek|Australia', 'Mount Isa|Australia',
    'Invercargill|New Zealand', 'Port Blair|India',
  ],
};
