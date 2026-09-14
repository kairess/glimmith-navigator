좋아. 이건 **“1225개 퍼즐을 한 화면에 나열하는 UI”로 만들면 실패**하고, **스테인드글라스 = 하나의 앨범/챕터**로 잡는 게 맞습니다. 실제 게임도 한 창 안에서 일정 수를 풀면 silver → gold → 전부 완료 시 gems로 진행되는 구조이고, 예시로 어떤 창은 20개에서 silver, 33개에서 gold, 41개 전체 완료에서 gems가 됩니다. ([스팀 커뮤니티][1])

제가 생각하는 가장 좋은 구조는 이겁니다.

```text
┌──────────────────────────────────────────────────────────────┐
│  GLIMMITH NAVIGATOR                              742 / 1225  │
│  ███████████████████░░░░░░░░░░░░   60.6%                   │
│                                                              │
│  [ All ] [ Unfinished ] [ In Progress ] [ Completed ]   🔍   │
├──────────────────────┬───────────────────────────────────────┤
│ WINDOWS              │  AREA NUMBER                          │
│                      │                                       │
│ ◈ Area Number        │       [ stained glass thumbnail ]    │
│   38 / 41     93%    │                                       │
│   ████████████░      │       38 / 41 puzzles                │
│                      │       ██████████████████░░  92.7%    │
│ ◇ Palisade           │          S        G             ◆    │
│   24 / 38     63%    │         20       33            41    │
│   ████████░░░░░      │                                       │
│                      │  [Unfinished 3] [All] [Difficulty ▼]  │
│ ✓ Uniformity         │                                       │
│   36 / 36    100%    │  ○  #40883    Difficulty 2           │
│   █████████████      │     Area Number · Bricky              │
│                      │                             [Locate →] │
│ ◈ Loopy              │  ✓  #15576    Difficulty 2           │
│   18 / 44     41%    │     Bricky · Area Number              │
│                      │                                       │
│ ...                  │  ○  #73192    Difficulty 5           │
│                      │     Area Number · Mismatch             │
└──────────────────────┴───────────────────────────────────────┘
```

### 핵심은 왼쪽의 **Stained Glass Navigator**

창 하나당 카드 하나입니다.

카드에는 정보가 많으면 안 되고 딱

**창 그림/아이콘 · 이름 · `38 / 41` · progress bar · 93%**

정도만 보여주는 게 좋습니다.

그리고 상태를 색깔보다 **형태까지 다르게** 해야 합니다.

`○ 진행 중` → `◈ Gold` → `◆ Perfect/Gem` 같은 방식입니다.

그러면 40~50개의 창이 있어도 아래로 슥 스크롤하면서

> “아, 여기는 2개 남았고, 여기는 다 했고, 여기는 절반밖에 안 했구나”

가 즉시 보입니다.

1225개의 puzzle row를 탐색하는 게 아니라 **수십 개 stained glass만 탐색하게 만드는 것**이 핵심입니다.

---

### 전체 진행률은 화면 최상단에 크게

이건 꽤 만족감을 주는 기능이 될 겁니다.

예를 들면:

**742 / 1,225 puzzles**

**60.6% COMPLETE**

그리고 아래 작은 숫자로

**12 / 31 Windows Perfected**

같은 두 번째 progression을 넣습니다.

게임 자체에서도 퍼즐 전체 클리어와 완전히 완성한 창을 별도로 추적하는 개념이 있기 때문에 자연스럽습니다. 실제 UI에서 gems가 붙은 window를 완전히 끝낸 area로 취급합니다. ([스팀 커뮤니티][1])

상단 progress bar에는 아주 미세하게 milestone marker를 넣어도 예쁩니다.

```text
742 / 1225     60.6%

━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━
                ↑ you
```

그리고 **오늘 +12**, **이번 플레이 세션 +7** 같은 건 나중에 추가할 수 있습니다. MVP에는 필요 없습니다.

---

## 선택한 Stained Glass 안에서는 **무조건 List**

여기서는 사용자가 말한 방향이 정확합니다.

퍼즐을 작은 사각형 41개로 표현하는 것보다:

```text
○  #40883     Difficulty 2     Area Number
✓  #59310     Difficulty 3     Area Number · Bricky
○  #83721     Difficulty 4     Area Number · Mismatch
✓  #10352     Difficulty 5     Area Number · Palisade
○  #77193     Difficulty 6     Area Number · Loopy
```

가 훨씬 좋습니다.

왜냐하면 이 게임은 공식적으로 각 퍼즐에 **고유한 5자리 Puzzle ID**를 추가했습니다. 개발사도 walkthrough나 solution guide에서 퍼즐을 식별하기 위한 목적으로 넣었다고 설명합니다. ([스팀 커뮤니티][2])

즉 Navigator에서 이 ID를 primary identifier로 쓰면 아주 자연스럽습니다.

다만 ID가 맨 앞에서 너무 튀지는 않게 합니다.

**Difficulty 5**
`#77193`

정도의 hierarchy가 좋습니다.

---

## 내가 특히 넣고 싶은 것이 **“Unfinished only”**

사실 Navigator를 쓰는 사람의 대부분은

> “내가 뭘 안 풀었지?”

를 찾으러 들어올 겁니다.

그러니 window를 누르는 순간 기본 화면을 이렇게 하는 것도 좋습니다.

**UNFINISHED · 3**

```text
○ Difficulty 4    #52480
○ Difficulty 6    #73912
○ Difficulty 7    #19462
```

바로 아래에 작게:

`Show all 41 puzzles`

이 방식이면 이미 푼 38개가 화면을 차지하지 않습니다.

---

## 그리고 퍼즐마다 **Locate** 버튼이 있어야 합니다

여기까지 만들 거라면 이게 Navigator의 킬러 기능이라고 봅니다.

```text
○ Difficulty 6    #73912

                    [ Locate ]
```

누르면

**게임 월드 카메라가 해당 puzzle pedestal로 이동**

또는 최소한

**방향 indicator를 띄움**

입니다.

그러면 이것은 단순 completion tracker가 아니라 진짜 **Navigator**가 됩니다.

최종적으로는:

> Navigator 열기 → `Unfinished` → 하나 선택 → Locate → 퍼즐 풀기 → 자동으로 ✓ → 다음 미완료

라는 루프가 됩니다.

이게 매우 좋습니다.

---

# Stained Glass 상세화면도 예쁘게 만들 수 있음

제가 특히 추천하는 부분입니다.

상단을 그냥 text header로 만들지 말고 **실제 stained glass의 작은 이미지를 hero image처럼 사용**합니다.

예를 들어:

```text
        ╭─────────────╮
        │             │
        │ stained     │
        │ glass art   │
        │             │
        ╰─────────────╯

          AREA NUMBER

            38 / 41
             92.7%

    ─────●────────●────────○
         20       33       41
       Silver    Gold     Gems
```

게임의 progression 자체를 그대로 UI language로 가져오는 겁니다.

그래서 별도의 현대적인 dashboard처럼 보이기보다 **Glimmith의 도감**처럼 보이게 하는 게 훨씬 잘 어울립니다.

![Image](https://clan.akamai.steamstatic.com/images/45917949/17bdf4797438e5695a5382c76e8cb4e284a93f37.png)

![Image](https://clan.fastly.steamstatic.com/images/45917949/34ba8fd616c8a0a52eaef2433d3fb5c6d9db8a64.png)

게임 자체의 parchment + stained-glass 미술 스타일을 따라가면 모드가 외부 프로그램처럼 보이지 않을 겁니다.

---

## 1200개를 다루기 때문에 Search/Filter도 중요

검색창에는 그냥 ID를 입력하면 됩니다.

`40883`

→ 바로 해당 puzzle과 stained glass를 보여줍니다.

필터는 처음에는 네 개면 충분합니다.

**Unfinished / Completed / Difficulty / Rule**

예:

`Unfinished + Difficulty 6–7`

하면 게임 전체에서 어려운 미완료 퍼즐만 나옵니다.

또는

`Loopy + Unfinished`

하면 Loopy가 포함된 미완료 퍼즐만.

이건 나중에 굉장히 강력해집니다.

---

## 숨겨진 퍼즐 때문에 **Spoiler Mode**가 필요합니다

이 부분은 꼭 고려해야 합니다.

개발자가 각 area의 정확한 puzzle 수를 처음부터 공개하지 않는 것이 **의도적인 게임 디자인이며 특정 surprise를 spoiler하지 않기 위해서**라고 직접 설명했습니다. 후반이 되면 총 puzzle count를 보여줍니다. ([스팀 커뮤니티][3])

따라서 Navigator에 설정 하나를 넣겠습니다.

**Respect game progression ☑**

켜져 있으면:

```text
Area Number

33 completed
3 discovered puzzles remaining
? undiscovered
```

처럼 게임에서 현재 플레이어가 알 수 있는 정보만 표시합니다.

끄면:

```text
38 / 41
3 remaining
```

으로 **Completionist Mode**가 됩니다.

모드 특성상 저는 기본값은 `Respect progression = ON`으로 하겠습니다.

---

# 퍼즐 상태는 4단계가 가장 좋습니다

세이브에서 정보를 얻을 수 있다는 전제하에:

**✓ Completed**

**◐ In Progress**

**○ Discovered / Unsolved**

**? Undiscovered**

입니다.

예:

```text
✓  Difficulty 2   #13572
✓  Difficulty 3   #77182
◐  Difficulty 5   #62814       Continue →
○  Difficulty 6   #38155       Locate →
?  Undiscovered
```

특히 **In Progress**가 있으면 상당히 좋습니다.

게임 업데이트 내역에도 `half solved puzzles`라는 별도의 상태가 존재한다는 단서가 있습니다. 즉 내부적으로 solved / unsolved 외에 추가 상태가 저장될 가능성이 있습니다. ([스팀 커뮤니티][4])

실제 save 구조를 뜯어봐야 확정할 수 있습니다.

---

# 데이터 구조도 처음부터 이렇게 잡는 게 좋습니다

UI와 data를 분리해서:

```text
Game
 ├── Window
 │    ├── id
 │    ├── name
 │    ├── region
 │    ├── image
 │    ├── silverThreshold
 │    ├── goldThreshold
 │    └── puzzles[]
 │
 └── Puzzle
      ├── puzzleId       # 5-digit official ID
      ├── difficulty
      ├── rules[]
      ├── state
      ├── discovered
      ├── worldPosition
      └── windowId
```

이 정도로 갑니다.

특히 `worldPosition`은 나중의 **Locate** 때문에 처음부터 넣어두는 것이 좋습니다.

---

## 구현 방식도 방향이 보입니다

여기서 중요한 사실 하나를 이미 확인했습니다.

공식 save는 Windows에서

`%LOCALAPPDATA%\Geri\Saved\SaveGames`

에 있고 `SaveFile1.sav` 및 rolling backup 형태로 저장됩니다. ([스팀 커뮤니티][5])

그래서 저는 **첫 버전부터 게임 메모리를 해킹하는 방식으로 만들지 않겠습니다.**

먼저:

**SaveFile → Parser → Navigator UI**

로 만드는 것이 낫습니다.

Navigator는 `.sav`를 **read-only**로 감시하고, save가 갱신될 때마다 UI를 refresh합니다.

그러면 게임 안정성에 거의 영향을 주지 않습니다.

이 단계에서

**1225 Puzzle ID ↔ Stained Glass ↔ Difficulty ↔ Completion**

매핑만 확보되면 **전체 진행률 + window별 목록 + 미완료 목록은 전부 구현 가능**합니다.

그다음 2단계에서만 UE4SS/메모리 접근을 붙여서 **Locate** 기능을 추가하면 됩니다.

---

### 그래서 MVP를 딱 정하면

**Glimmith Navigator v0.1**

1. **전체 `Completed / 1225` + %**
2. **모든 Stained Glass 목록**
3. **각 Glass의 `Completed / Total` + %**
4. **선택한 Glass의 전체 puzzle list**
5. **Completed / Unfinished 표시**
6. **5-digit Puzzle ID**
7. **Difficulty 표시**
8. **Unfinished-only filter**
9. **Puzzle ID 검색**
10. **Spoiler protection**

여기까지면 이미 **실제로 배포할 가치가 있는 QoL 모드**라고 봅니다.

그리고 UI에서 가장 중요한 결정은 **“1225개를 한꺼번에 보여주지 않는다”**입니다. `전체 진행률 → Stained Glass → 개별 Puzzle`이라는 3단계 hierarchy로 만들면 1200개라는 숫자가 오히려 컬렉션을 완성해가는 재미로 바뀝니다. 실제 커뮤니티의 100% 가이드도 1225개를 `지역 + 난이도 + 번호`로 나눠 정리하고 있어서 이 계층 구조가 이미 사용자들의 실제 탐색 방식과도 잘 맞습니다. ([스팀 커뮤니티][4])

다음은 **UI보다 먼저 `.sav` 안에 1225개 퍼즐의 completion 정보가 어떤 형태로 저장되어 있는지 확인하는 것**이 좋습니다. 그걸 알아내면 이 Navigator가 실제로 가능한지 거의 확정할 수 있습니다.

[1]: https://steamcommunity.com/app/4160210/discussions/0/841753143030102770/?utm_source=chatgpt.com "Confused about the game's progress tracking :: The Artisan of Glimmith General Discussions"
[2]: https://steamcommunity.com/app/4160210/allnews/?utm_source=chatgpt.com "Steam Community :: The Artisan of Glimmith"
[3]: https://steamcommunity.com/app/4160210/discussions/0/796712966523198840/?l=english&utm_source=chatgpt.com "Golden window doesn't mean completed? :: The Artisan of Glimmith General Discussions"
[4]: https://steamcommunity.com/app/4160210?l=koreana "Steam 커뮤니티 :: The Artisan of Glimmith"
[5]: https://steamcommunity.com/app/4160210/discussions/0/800093528412707949/?utm_source=chatgpt.com "Troubleshooting guide (故障排除指南) for crashes, corrupt save files, or other technical problems. :: The Artisan of Glimmith General Discussions"
