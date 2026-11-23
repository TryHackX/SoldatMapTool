# Czyste archiwum map Soldat

## Jedna paczka z SMA i map zainstalowanych w grze

1. W ustawieniach Map Studio sprawdź **folder instalacji Soldat**. Następnie otwórz **Porządki → Czyste archiwum** i jako folder źródłowy wskaż główny katalog archiwum SMA. Zostaw zaznaczone rozpakowane pliki, paczki, indeks SMA i skrót zawartości w nazwach grafik.
2. Zaznacz **Dołącz mapy z mojej instalacji Soldat** oraz **Pakuj mapy z brakami i zapisz missing/<nazwa_mapy>.txt**. Studio wczyta też z instalacji katalogi `maps` i, jeśli istnieje, `downloads/maps`. Pole **Dodatkowe źródła grafik** służy do wskazania kolejnych miejsc z zasobami.
3. Wybierz **Analizuj archiwum**. Po analizie liczba **Mapy do eksportu** obejmuje również pozycje **W tym mapy z raportem braków**. Studio usuwa nieużywane wpisy scenerii, uzgadnia nazwy plików z odwołaniami w PMS i zapisuje rozszerzenie `.pms`. Identyczne wyniki współdzielą plik. Różniące się wersje o tej samej nazwie mogą dostać osobne nazwy.
4. Wybierz **Eksportuj czystą kopię → Pobierz ZIP do gry**. Jeśli chcesz jeszcze coś poprawić w Studio, kliknij **Dodaj gotowe mapy do biblioteki** i wybierz dodany folder jako źródło. Przy pakowaniu poprawionych map Studio ponownie sprawdza zależności. W raporcie zachowuje oryginalne nazwy plików, których wciąż brakuje.
5. Aby podmienić bibliotekę w grze, przenieś dotychczasowe `maps` oraz ewentualne `downloads/maps` do kopii zapasowej poza instalacją. Rozpakuj ZIP do folderu zawierającego `soldat.exe`. Powinny się tam znaleźć `maps`, `scenery-gfx`, `textures` i, dla niekompletnych map, `missing`. Folderów z grafikami używają też inne zasoby gry. Scal je z zawartością ZIP, zachowując dotychczasowe pliki.

W połączonej bibliotece zwykłą nazwę PMS przydziela się w pierwszej kolejności najnowszej datowanej wersji. Studio odczytuje datę pliku w instalacji oraz datę wpisu w oryginalnych ZIP-ach, także zagnieżdżonych, po potwierdzeniu SHA-256 mapy. Przy jednakowej dacie pierwszeństwo ma kopia z gry, następnie RSCS. Wybierz **Wersje i daty map (CSV)**, aby porównać warianty o tej samej nazwie. W pliku `report/wersje-map.csv` znajdziesz daty, nazwy po eksporcie i ścieżki do wydań źródłowych. Pusta data oznacza brak potwierdzonej daty pliku. Data pliku jest wskazówką, szczególnie po ręcznym kopiowaniu map.

O wyborze wersji decydują daty plików źródłowych sprzed czyszczenia. Gotowy PMS zachowuje datę wybraną z jego źródeł. Gdy brakuje potwierdzonej daty, raport zostawia puste pole, a plik dostaje techniczną datę 1 stycznia 1980, najwcześniejszą obsługiwaną w ZIP. Dzięki temu kolejne scalenie poprawnie traktuje taki plik jako niedatowany.

Każda wyeksportowana mapa z brakami ma jeden `missing/<końcowa_nazwa_mapy>.txt`, z sekcjami `Scenery:`, `Textures:` i `Edges:`. Zapis `stara_nazwa -> nowa_nazwa` pokazuje nazwę do szukania i nazwę, pod którą należy zapisać uzupełnienie. Katalogi docelowe to odpowiednio `scenery-gfx`, `textures` i `textures/edges`. Krawędzie terenu są opcjonalne. Studio zgłasza problem z wykrytą krawędzią, np. uszkodzony obraz. Oryginały PMS, których struktury nie udało się naprawić, znajdziesz w `review/maps` obok eksportu.

## Szukanie brakujących grafik w innych paczkach

W **Porządki → Czyste archiwum** wskaż archiwum źródłowe. W polu **Dodatkowe źródła grafik** wpisz ścieżki do folderów instalacji Soldat, katalogów z mapami albo pojedynczych paczek ZIP i RAR, po jednej w wierszu. Uruchom analizę, a następnie **Eksportuj czystą kopię**. Wskazane biblioteki dostarczają dowodów oraz potrzebnych grafik. O dodaniu map z aktywnej instalacji decyduje opcja **Dołącz mapy z mojej instalacji Soldat**.

Jeśli autor lub serwer wydał zestaw kilku map ze wspólnymi grafikami, wskaż bezpośrednio plik tej paczki. Studio może potwierdzić brakujący zasób, gdy znajdzie identyczny źródłowy PMS w `maps` i wymaganą grafikę we właściwym katalogu tego samego wydania. Sprawdza również wymiary zapisane w mapie, dostępne krawędzie tekstury i sprzeczne wersje.

Studio potrafi połączyć obraz z mapą przez oryginalne wydanie zawierające ten sam źródłowy PMS. Dla scenerii wykorzystuje także datę zapisaną przez autora, rzeczywiste wymiary i pochodzenie pliku. Przy starym kodowaniu lub krótkiej nazwie DOS sprawdza możliwe pełne nazwy i sumy zawartości. Zapisuje w raporcie, który plik uzasadnił dopasowanie. Gdy pasuje kilka różnych obrazów, w trybie pakowania map z brakami raport wymienia sporny zasób. Przy wyłączonej opcji mapa trafia do kolejki do sprawdzenia.

Po ponownej analizie tego samego archiwum wybierz **Odzyskiwanie brakujących grafik (CSV)**. Raport zawiera po jednym wierszu dla każdego wystąpienia z poprzedniego wydania, któremu brakowało tekstury lub scenerii. Kolumna **Weryfikacja lub pozostała przyczyna** wskazuje także częściowe dopasowania, gdy brakuje jeszcze innego zasobu. **Plik wynikowy** prowadzi do gotowego PMS.

## Pierwszy przebieg

1. W Map Studio otwórz **Porządki → Czyste archiwum**. Ten sam panel jest dostępny z warsztatu map.
2. Wskaż główny folder kolekcji. Dla SMA wybierz katalog zawierający zarówno paczki, jak i rozpakowany katalog `Maps`. Zaznacz rozpakowane pliki, skompresowane paczki i indeks SMA. Kliknij **Analizuj archiwum**. Możesz zamknąć panel i do niego wrócić.
3. Sprawdź liczbę gotowych map i liczbę wystąpień wymagających sprawdzenia. **Mapy do sprawdzenia (CSV)** zawiera przyczyny i kandydatów z innych paczek. Pozycja wskazana na podstawie samej nazwy wymaga obejrzenia. Pełny raport JSON zawiera źródła, nazwy wynikowe i SHA-256.
4. Kliknij **Eksportuj czystą kopię**. Po weryfikacji Map Studio pokaże pełną ścieżkę. Każde zadanie ma osobny folder w `exports/clean-archives`. Przycisk **Dodaj gotowe mapy do biblioteki** rejestruje tylko podfolder **`maps`** jako dodatkowe źródło. Możesz to również zrobić w ustawieniach. Studio rozpozna sąsiednie `scenery-gfx` i `textures`.

Domyślnie nowe zadanie dodaje do nazw grafik skrót ich zawartości. Ma to znaczenie po przeniesieniu map do istniejącej instalacji, w której np. `tree.png` może przesłonić archiwalne `tree.bmp`. Nazwa tekstury uwzględnia także tożsamość jej krawędzi. Dla osobnego katalogu danych można wyłączyć tę opcję i zachować krótsze nazwy. Mapy nadal mają czytelne nazwy. Przy ręcznym kopiowaniu map do istniejącej instalacji sprawdź, czy dana nazwa PMS jest już zajęta. Dodanie folderu jako źródła w Studio pozwala przeglądać mapy bez kopiowania czegokolwiek do gry.

Katalog gry w gotowej kopii tworzą `maps/`, `scenery-gfx/` i `textures/` wraz z `textures/edges/`, jeśli mapa ma własne krawędzie. W `review/maps/` są zachowane problematyczne oryginały oznaczone sumą kontrolną. W `review/unreferenced/` są nieprzypisane zasoby z katalogów gry. W `report/` pozostają plan, CSV i wykaz pochodzenia plików. Katalogi podglądów, pliki tekstowe i pliki starszego formatu `.pmp` pozostają w źródle.

## Jak powstaje kopia

Celem są pliki PMS i zasoby graficzne obsługiwane przez linię Soldat 1.7.x. Przejście na grafikę HD w tej wersji objęło m.in. scenerie. Dlatego przy odzyskiwaniu wyglądu starej mapy znaczenie mają zarówno bajty obrazka, jak i wymiary zapisane w PMS. [Informacja o wydaniu Soldat 1.7.1](https://www.soldat.pl/en/post/soldat-1_7_1-release)

| Etap | Działanie | Warunek przyjęcia |
| --- | --- | --- |
| Inwentaryzacja | Odczyt luźnych plików, paczek i ich zawartości z zachowaniem oryginalnej ścieżki oraz pisowni. W indeksie SMA ta sama fizyczna grafika może reprezentować wiele paczek. | Materiał z indeksu ma zgodny rozmiar i SHA-256. Brakujące części archiwum, nieobsługiwane formaty i ograniczenia odczytu trafiają do raportu. |
| Ustalenie zależności | Studio szuka tekstury, aktywnych scenerii i pasujących krawędzi w kontekście paczki. Uwzględnia nazwy zapisane w PMS, warianty wielkości liter, zamienniki PNG i pliki standardowe dostępne w skonfigurowanej instalacji. | Dla każdej wymaganej grafiki da się wskazać konkretną zawartość. Niejednoznaczny wybór pozostaje w wykazie do sprawdzenia. |
| Nazwy i poprawki | Studio przydziela przenośne, krótkie nazwy z małych liter, odwołania w PMS przepisuje z dokładną pisownią. Każda mapa ma rozszerzenie `.pms`. Poprawia rozpoznane błędne wymiary scenerii, usuwa martwe definicje i przelicza ich indeksy. | Identyczne grafiki o różnych nazwach mogą dostać jeden plik w danym katalogu gry. Różne bajty dostają odrębne nazwy. Dwie tekstury o tych samych bajtach mogą wymagać osobnych nazw, jeżeli ich krawędzie różnią się zawartością. |
| Deduplikacja map | Porównanie SHA-256 map po przypisaniu właściwych zasobów i zapisaniu odwołań. W raporcie zostają wszystkie wystąpienia. | Dwa identyczne źródłowe PMS z różnymi grafikami paczek mogą dać dwie poprawne mapy. Wspólny plik wynikowy wymaga identycznych bajtów końcowego PMS. |
| Weryfikacja | Ponowny odczyt zapisanych plików, weryfikacja sum, poprawności nagłówków i dokładnej pisowni odwołań do plików w eksporcie. | Folder wynikowy zostaje udostępniony po przejściu weryfikacji. Weryfikacja plików nie obejmuje przejazdu ani uruchomienia gry. |

Znany czas modyfikacji pomaga przydzielić krótszą nazwę jednej z wersji. O wyborze grafiki decyduje powiązanie z paczką mapy. Indeks tej kolekcji nie zawiera oryginalnych dat wszystkich członków paczek, więc przy braku dat wybór nazwy jest powtarzalny według ścieżki.

Analiza odczytuje dane obrazu PNG, JPEG i GIF oraz sprawdza kompletność danych pikseli i kodowania starszych BMP i TGA. Dla uszkodzonego BMP lub PNG może odszukać kompletny plik również pod inną nazwą. Odzyskanie wymaga jednego jednoznacznego dopasowania zawartości i zgodności wszystkich zachowanych bajtów. Jeśli uszkodzona grafika jest używana na mapie i nie ma potwierdzonej kopii, mapa trafia do `review/maps/`.

Sektory kolizji w PMS wskazują poligony numerowane od 1. Przy odwołaniu poza zakresem Studio odtwarza siatkę z geometrii mapy, zachowuje jej podział i zapisuje naprawę w raporcie. Dzięki temu można odnaleźć każdą mapę, na której zmieniło się wyszukiwanie kolizji. [Odczyt sektorów w silniku OpenSoldat](https://github.com/opensoldat/opensoldat/blob/develop/shared/PolyMap.pas#L195-L245)

Dla tras botów Studio zeruje odwołanie do nieistniejącego punktu, pozostawiając jego miejsce w tabeli i pozostałe połączenia. Jeśli uszkodzony licznik uniemożliwia wiarygodny odczyt tej tabeli lub używana sceneria ma niepoprawną pozycję, obrót albo skalę, przyczyna trafia do raportu ręcznej weryfikacji.

### Kiedy czytać surowe paczki

Indeks SMA opisuje stan kolekcji z chwili zebrania. Studio sprawdza materiał wskazany przez indeks oraz przegląda dodatkowe pliki w źródle. Aby ponownie zbadać same obecne paczki, wybierz **Skompresowane paczki**, wyłącz **Rozpakowane mapy i zasoby** oraz indeks. To przydaje się po zmianie zawartości starej paczki albo po rozbieżności sumy pliku z indeksem.

ZIP i ZIP64 program czyta bez zewnętrznego ekstraktora. Dla surowych RAR i 7z potrzebne mogą być Python 3 i systemowa biblioteka libarchive, a dla wieloczęściowego RAR także UnRAR. Brak czytnika lub części paczki pojawia się w raporcie. Kompletna rozpakowana kolekcja z indeksem SMA pozwala odtworzyć pochodzenie plików bez ponownego rozpakowywania tych paczek.

### Jak odzyskać kolejną mapę z raportu

1. Otwórz `report/review.csv`. Kolumny **Blocked original** i **Reason for review** wskazują paczkę, mapę oraz problem. **Review copy after export** wskazuje zachowany oryginał. Jedna mapa może mieć kilka wierszy z różnymi kandydatami.
2. Jeśli **Canonical map after export** zawiera nazwę, otwórz ją w Studio. Sprawdź **Candidate basis**. Zgodna suma oryginalnego PMS potwierdza identyczne bajty mapy źródłowej, lecz grafiki w dwóch paczkach mogą się różnić. Dopasowanie nazwy lub rozmiaru wymaga porównania wyglądu.
3. Jeśli odnalazłeś właściwy brakujący plik, skopiuj PMS i grafiki tej paczki do osobnego folderu roboczego z podkatalogami `maps`, `scenery-gfx` i `textures`. Dodaj odzyskany plik w odpowiednim podkatalogu i pod nazwą wymaganą przez mapę. Uruchom **Czyste archiwum** na tym folderze. Możesz w ten sposób sprawdzać pojedynczą naprawę bez ponownego przetwarzania całej kolekcji.

## Wyszukiwanie wersji roboczych i podobnych map

W głównej bibliotece zaznacz mapy albo wybierz prefiks lub filtr. Otwórz **Znajdź podobne do zaznaczonych**. W warsztacie przycisk znajduje się obok **Optimize**. Wybierz zakres, próg podobieństwa i interesujące kryteria. Przykłady:

- **Inna nazwa, podobna mapa.** Włącz kształt terenu i wyłącz nazwy. Porównaj sylwetki obu wyników. Maska terenu uwzględnia względny układ poligonów, więc przesunięcie całej mapy nie przekreśla podobieństwa.
- **Podmieniona albo przemianowana dekoracja.** Wybierz tryb **Scenerie** i kryterium wyglądu. Dostaniesz pary konkretnych grafik, także wewnątrz jednej wybranej mapy. Możesz osobno porównać nazwy. W trybie map kryterium scenerii ocenia podobieństwo zestawów dekoracji używanych na dwóch mapach.
- **Kopie poza wybraną grupą.** Dla zaznaczonych map włącz porównywanie z resztą biblioteki. W każdej parze wyniku będzie przynajmniej jedna pozycja związana z zaznaczeniem.
- **Wersje robocze.** W wynikach porównania możesz pokazać wszystkie pary, wybrać tylko pary z roboczą nazwą albo je ukryć. W trybie **Scenerie** ten wybór dotyczy poszczególnych grafik. W bibliotece wpisz `is:draft` dla map lub `is:draft-scenery` dla map używających scenerii o roboczej nazwie. Minus wyklucza te pozycje. Przykład `-is:draft -is:draft-scenery`. Oznaczenia takie jak `beta`, `wip` i `v2` są wskazówką z nazwy. Autor mógł opublikować tak nazwaną finalną wersję.

Przy dużych zbiorach narzędzie wybiera kandydatów przed dokładnym porównaniem i wyświetla do 500 najwyżej ocenionych par. W trybie **Mapy** kryterium wyglądu dekoracji bierze pod uwagę maksymalnie 48 najczęściej używanych scenerii danej mapy. Wynik procentowy służy do oglądania podobnych wersji. O scaleniu pliku podczas czyszczenia decyduje jego zawartość.

## Usuwanie martwych wpisów scenerii

W otwartej mapie wybierz **Walidacja → Usuń nieużywane wpisy scenerii**. Polecenie pokazuje liczbę usuniętych definicji i można je cofnąć. W kreatorze paczki włącz **Usuń nieużywane wpisy scenerii z pakowanych map**. Opcja działa przy eksporcie do folderu, ZIP, SMAP i paczek podzielonych na grupy. Zmieniany jest PMS w paczce. Oryginalny plik na dysku zachowuje swoją postać. Manifest CRC dotyczy rzeczywiście spakowanych bajtów.
