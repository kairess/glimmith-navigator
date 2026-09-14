-- Glimmith Navigator: production bridge between the game and the Electron
-- overlay app. All diagnostic/exploration keybinds from development have
-- been removed -- this file now only does the three things the overlay
-- actually needs, via a single 500ms polling loop:
--
--   1. Locate/teleport: watches goto_request.txt for a puzzleId written by
--      the overlay's "Locate" button, finds the matching live PuzzleCube_C,
--      teleports GeriCharacter_C to it, and highlights it (the game's own
--      "find this puzzle" glow).
--   2. Auto-hide state: writes gamestate.txt ("1"/"0") so the overlay knows
--      whether to show itself -- shown ONLY on the world map, hidden while
--      an actual puzzle is open (PuzzleCube.InPuzzle) or in the main menu
--      (GeriCharacter_C still sitting at the unset origin position).
--   3. Hover tooltip: writes hover.txt with whichever puzzle the OS mouse
--      cursor is currently over (raycast from the deprojected mouse
--      position), so the overlay's cursor-following tooltip can show its
--      name/number -- puzzle boxes are often clustered/hard to tell apart.
--   4. Self-updating catalog: periodically re-scans every live PuzzleCube_C
--      and writes puzzle_positions_live.jsonl, so the overlay's puzzle list
--      stays correct even after a game update adds/moves/removes puzzles --
--      no manual re-scan needed.
--
-- See docs/ or git history for the diagnostic version if any of this needs
-- re-investigating (property dumps, widget/actor hunts, etc.).

local function is_valid(obj)
    if obj == nil then return false end
    local ok, v = pcall(function() return obj:IsValid() end)
    return ok and v == true
end

local function class_name_of(obj)
    local ok, cls = pcall(function() return obj:GetClass():GetFName():ToString() end)
    if ok then return cls end
    return "?"
end

-- Best-effort stringify of a single property's value. Only Str/Name (via
-- ToString()) and scalar types (via tostring()) are handled -- Struct/Array/
-- Object properties are deliberately skipped: blindly stringifying those
-- crashed the game once during development.
local function try_read_prop(obj, propName, typeFullName)
    local okVal, val = pcall(function() return obj[propName] end)
    if not okVal or val == nil then return nil end
    if string.find(typeFullName, "StrProperty") or string.find(typeFullName, "NameProperty") then
        local ok, s = pcall(function() return val:ToString() end)
        if ok and type(s) == "string" then return s end
        return "(ToString failed)"
    end
    if string.find(typeFullName, "BoolProperty") or string.find(typeFullName, "IntProperty")
        or string.find(typeFullName, "FloatProperty") or string.find(typeFullName, "ByteProperty")
        or string.find(typeFullName, "EnumProperty") or string.find(typeFullName, "DoubleProperty") then
        local ok, s = pcall(function() return tostring(val) end)
        return ok and s or "?"
    end
    return nil -- StructProperty/ArrayProperty/ObjectProperty/etc: not safe, skip
end

-- Live "Locate" bridge: the Navigator app writes a PuzzleID (e.g.
-- "AGeri/Puzzles/Zone2/2-palisade/0441.puz") into goto_request.txt (next to
-- this script). We poll it every 500ms; if it has content, find that exact
-- live PuzzleCube_C, teleport GeriCharacter_C to it, AND set IsHighlighted
-- on it (the game's own "find this puzzle" glow). Any previously-highlighted
-- cube is un-highlighted first.
local REQUEST_FILE = "Mods/GlimmithNavDiag/goto_request.txt"
local lastHighlighted = nil

local function read_request()
    local ok, f = pcall(io.open, REQUEST_FILE, "r")
    if not ok or not f then return nil end
    local content = f:read("*a")
    f:close()
    if not content or content:match("^%s*$") then return nil end
    return content:match("^%s*(.-)%s*$") -- trim
end

local function clear_request()
    pcall(function()
        local f = io.open(REQUEST_FILE, "w")
        if f then f:close() end
    end)
end

local function find_cube_by_id(puzzleId)
    local ok, all = pcall(function() return FindAllOf("PuzzleCube_C") end)
    if not ok or not all then return nil end
    for _, obj in pairs(all) do
        if is_valid(obj) then
            local dir = try_read_prop(obj, "PuzzleDirectory", "StrProperty") or ""
            local file = try_read_prop(obj, "PuzzleFile", "StrProperty") or ""
            if dir ~= "" and (dir .. "/" .. file) == puzzleId then
                return obj
            end
        end
    end
    return nil
end

-- Self-updating puzzle catalog: periodically re-scan every live PuzzleCube_C
-- in the world and write it out, so the overlay's catalog stays correct
-- even if a game update adds/removes/moves puzzles -- no manual re-scan or
-- code change needed. Runs once ~10s after the mod loads (giving the level
-- time to finish streaming in) and then every ~100s afterwards, which is
-- cheap enough not to be noticeable (this is the same read this mod already
-- does per-request in find_cube_by_id, just for every cube at once instead
-- of one at a time).
local LIVE_POSITIONS_FILE = "Mods/GlimmithNavDiag/puzzle_positions_live.jsonl"
local tickCount = 0

local function scan_puzzle_positions()
    local ok, all = pcall(function() return FindAllOf("PuzzleCube_C") end)
    if not ok or not all then
        print("GlimmithNavDiag: puzzle position scan failed (FindAllOf)\n")
        return
    end
    local f = io.open(LIVE_POSITIONS_FILE, "w")
    if not f then
        print("GlimmithNavDiag: could not open puzzle_positions_live.jsonl for write\n")
        return
    end
    local n = 0
    for _, obj in pairs(all) do
        if is_valid(obj) then
            local dir = try_read_prop(obj, "PuzzleDirectory", "StrProperty") or ""
            local file = try_read_prop(obj, "PuzzleFile", "StrProperty") or ""
            local okLoc, loc = pcall(function() return obj:K2_GetActorLocation() end)
            local okName, instName = pcall(function() return obj:GetFName():ToString() end)
            if dir ~= "" and okLoc and loc then
                f:write(string.format(
                    '{"puzzleId":"%s/%s","instName":"%s","x":%s,"y":%s,"z":%s}\n',
                    dir, file, okName and instName or "", tostring(loc.X), tostring(loc.Y), tostring(loc.Z)
                ))
                n = n + 1
            end
        end
    end
    f:close()
    print(string.format("GlimmithNavDiag: puzzle position scan wrote %d entries\n", n))
end

LoopAsync(500, function()
    tickCount = tickCount + 1
    if tickCount == 20 or tickCount % 200 == 0 then
        pcall(scan_puzzle_positions)
    end

    local ok, content = pcall(read_request)
    if not ok then
        print(string.format("GlimmithNavDiag: goto_request read failed: %s\n", tostring(content)))
        return false
    end
    if content then
        clear_request()
        local cube = find_cube_by_id(content)
        if not cube then
            print(string.format("GlimmithNavDiag: goto request for unknown puzzle id: %s\n", content))
            return false
        end

        if lastHighlighted and is_valid(lastHighlighted) then
            pcall(function() lastHighlighted.IsHighlighted = false end)
        end
        local okHi, errHi = pcall(function() cube.IsHighlighted = true end)
        if okHi then lastHighlighted = cube end

        local okChar, char = pcall(function() return FindFirstOf("GeriCharacter_C") end)
        if not okChar or not is_valid(char) then
            print("GlimmithNavDiag: goto request but no GeriCharacter_C found\n")
            return false
        end
        local okLoc, loc = pcall(function() return cube:K2_GetActorLocation() end)
        local okRot, rot = pcall(function() return char:K2_GetActorRotation() end)
        if not okLoc then
            print("GlimmithNavDiag: could not read target cube location\n")
            return false
        end
        local target = { X = loc.X, Y = loc.Y, Z = loc.Z + 100 }
        local okTp, result = pcall(function() return char:K2_TeleportTo(target, okRot and rot or { Pitch = 0, Yaw = 0, Roll = 0 }) end)
        print(string.format("GlimmithNavDiag: goto %s ok=%s result=%s\n", content, tostring(okTp), tostring(result)))
    end

    -- Report whether the overlay should hide itself: shown ONLY on the
    -- world map. Hidden when the puzzle-solving screen (WBP_PuzzleUI_C) is
    -- visible, OR when GeriCharacter_C is still sitting at the exact origin
    -- (observed: main menu leaves it un-placed at 0,0,0; world map/puzzle
    -- both have a real position).
    pcall(function()
        -- There can be more than one WBP_PuzzleUI_C instance alive at once
        -- (e.g. a pooled/inactive one); check them all, not just the first.
        -- Widget Visibility was unreliable, and CurrentPuzzleCube keeps
        -- pointing at the last-opened cube even after closing it. The cube's
        -- OWN InPuzzle flag is the real "actively open right now" signal.
        local puzzleVisible = false
        local okAllPUI, allPUI = pcall(function() return FindAllOf("WBP_PuzzleUI_C") end)
        if okAllPUI and allPUI then
            for _, inst in pairs(allPUI) do
                if is_valid(inst) then
                    local okCube, cube = pcall(function() return inst.CurrentPuzzleCube end)
                    if okCube and is_valid(cube) then
                        local okIn, inP = pcall(function() return cube.InPuzzle end)
                        if okIn and inP == true then puzzleVisible = true end
                    end
                end
            end
        end

        local atOrigin = true
        local okChar, char = pcall(function() return FindFirstOf("GeriCharacter_C") end)
        if okChar and is_valid(char) then
            local okLoc, loc = pcall(function() return char:K2_GetActorLocation() end)
            if okLoc and loc then
                atOrigin = (loc.X == 0 and loc.Y == 0 and loc.Z == 0)
            end
        end

        local shouldHide = puzzleVisible or atOrigin
        local f = io.open("Mods/GlimmithNavDiag/gamestate.txt", "w")
        if f then
            f:write(shouldHide and "1" or "0")
            f:close()
        end
    end)

    -- Report which puzzle (if any) the mouse is currently hovering over, so
    -- the overlay app can show its name/number -- boxes are often clustered
    -- or partly hidden in-game and hard to tell apart by eye alone.
    local okHoverBlock, hoverErr = pcall(function()
        local hoverId = ""
        local okPC, pc = pcall(function() return FindFirstOf("PlayerController") end)
        if okPC and is_valid(pc) then
            local mouse, mouseUnused = {}, {}
            local okMouse, mouseOk = pcall(function() return pc:GetMousePosition(mouse, mouseUnused) end)
            if okMouse and mouseOk and mouse.LocationX then
                local worldLoc, worldDir = {}, {}
                local okDeproj, deprojOk = pcall(function()
                    return pc:DeprojectScreenPositionToWorld(mouse.LocationX, mouse.LocationY, worldLoc, worldDir)
                end)
                if okDeproj and deprojOk and worldLoc.X then
                    local endPoint = {
                        X = worldLoc.X + (worldDir.X or 0) * 200000,
                        Y = worldLoc.Y + (worldDir.Y or 0) * 200000,
                        Z = worldLoc.Z + (worldDir.Z or 0) * 200000,
                    }
                    local okCls, cls = pcall(function() return StaticFindObject("/Script/Engine.KismetSystemLibrary") end)
                    local okCdo, cdo = false, nil
                    if okCls and is_valid(cls) then okCdo, cdo = pcall(function() return cls:GetCDO() end) end
                    if okCdo and is_valid(cdo) then
                        local outHit = {}
                        local okTrace, traceOk = pcall(function()
                            return cdo:LineTraceSingle(pc, worldLoc, endPoint, 0, false, {}, 0, outHit, true,
                                { R = 1, G = 0, B = 0, A = 1 }, { R = 0, G = 1, B = 0, A = 1 }, 0.0)
                        end)
                        if okTrace and traceOk and outHit.Actor then
                            local okActor, actor = pcall(function() return outHit.Actor:Get() end)
                            if okActor and is_valid(actor) then
                                local okCN, cn = pcall(function() return class_name_of(actor) end)
                                if okCN and (cn == "PuzzleCube_C" or cn == "PuzzleCompletionCube_C") then
                                    local dir = try_read_prop(actor, "PuzzleDirectory", "StrProperty") or ""
                                    local file = try_read_prop(actor, "PuzzleFile", "StrProperty") or ""
                                    if dir ~= "" then hoverId = dir .. "/" .. file end
                                end
                            end
                        end
                    end
                end
            end
        end
        local hf = io.open("Mods/GlimmithNavDiag/hover.txt", "w")
        if hf then
            hf:write(hoverId)
            hf:close()
        end
    end)
    if not okHoverBlock then
        print(string.format("GlimmithNavDiag: hover block error: %s\n", tostring(hoverErr)))
    end

    return false -- never stop the loop
end)

print("GlimmithNavDiag: running (goto_request/gamestate/hover polling, 500ms)\n")
