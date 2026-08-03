Attribute VB_Name = "ExportTradelog"
' Export the tabs the dashboard needs from the Master workbook into MyStockPortfolio\Tradelog.xlsx.
'
' Import into the Master: Alt+F11 -> File -> Import File -> this .bas. Then put a button on a
' sheet (Developer -> Insert -> Button) and assign it PublishTradelog. The Master must be saved as
' .xlsm for the macro to persist.
'
' WHY THIS IS NOT "copy sheet, paste values, save"
'
' extract-portfolio.js reads Excel's CACHED cell values, and for one column it reads the FORMULA
' TEXT. Three Japanese rows record their price as "=3976/rngUSDJPY" because the workbook's data
' provider has no Tokyo coverage and prices those holdings off the US ADR. The app recovers the
' real yen price out of that formula's numerator. Paste values over column F and those three
' trades silently keep the USD ADR price instead — the numbers still look plausible, which is the
' worst kind of wrong.
'
' So this macro preserves formulas AND their cached values, and never lets Excel recalculate in
' the copy (the _FV provider and the live FX names are not connected there; a recalc turns those
' cells into #NAME?/#REF!, which the extractor refuses outright).
'
' It verifies the copy before overwriting anything, and keeps one backup.

Option Explicit

' --- Config -------------------------------------------------------------------------------
Private Const REPO_PATH As String = "C:\Users\leohk\MyStockPortfolio\"
Private Const OUT_NAME  As String = "Tradelog.xlsx"
' Forex travels with Tradelog on purpose: rngUSDJPY and friends live there, and copying both in
' ONE operation keeps those defined names local to the new file. Copy Tradelog alone and every
' name turns into an external reference to this workbook — the formula text stops matching
' "<yen>/rngUSDJPY" and the Japanese price recovery quietly stops firing.
Private Const TAB_LIST  As String = "Forex,Tradelog"
Private Const DATA_TAB  As String = "Tradelog"
' The columns extract-portfolio.js actually reads and requires to be numbers.
Private Const CHECK_COLS As String = "F,J,L,M,O,Q"

' --- Entry point --------------------------------------------------------------------------
Public Sub PublishTradelog()
    Dim prevCalc As XlCalculation
    Dim prevAlerts As Boolean, prevEvents As Boolean, prevScreen As Boolean
    Dim src As Workbook, out As Workbook
    Dim tabs() As String, i As Long
    Dim target As String, backup As String
    Dim jpBefore As Long, jpAfter As Long, bad As String, rowsOut As Long

    Set src = ThisWorkbook
    target = REPO_PATH & OUT_NAME
    backup = REPO_PATH & "Tradelog.backup.xlsx"
    tabs = Split(TAB_LIST, ",")
    For i = LBound(tabs) To UBound(tabs)
        tabs(i) = Trim$(tabs(i))
    Next i

    ' Fail before touching anything, not halfway through.
    For i = LBound(tabs) To UBound(tabs)
        If Not SheetExists(src, tabs(i)) Then
            MsgBox "Tab """ & tabs(i) & """ is not in this workbook." & vbLf & vbLf & _
                   "Tabs exported: " & TAB_LIST, vbCritical, "Export Tradelog"
            Exit Sub
        End If
    Next i
    If Dir(REPO_PATH, vbDirectory) = "" Then
        MsgBox "Repo folder not found:" & vbLf & REPO_PATH, vbCritical, "Export Tradelog"
        Exit Sub
    End If
    If IsFileLocked(target) Then
        MsgBox OUT_NAME & " is open in Excel. Close it and run again.", vbExclamation, "Export Tradelog"
        Exit Sub
    End If

    jpBefore = CountLocalPriceFormulas(src.Worksheets(DATA_TAB))

    prevCalc = Application.Calculation
    prevAlerts = Application.DisplayAlerts
    prevEvents = Application.EnableEvents
    prevScreen = Application.ScreenUpdating

    On Error GoTo Failed
    ' Manual calculation is the whole trick — see the header comment.
    Application.Calculation = xlCalculationManual
    Application.DisplayAlerts = False
    Application.EnableEvents = False
    Application.ScreenUpdating = False

    src.Sheets(tabs).Copy                  ' one operation, so the defined names stay local
    Set out = ActiveWorkbook

    ' A live connection in the copy could refresh on open and overwrite the cached values the
    ' extractor depends on. The cached numbers survive removal; the ability to refresh does not.
    RemoveConnections out

    ' --- Verify the copy BEFORE overwriting the published file ---------------------------
    jpAfter = CountLocalPriceFormulas(out.Worksheets(DATA_TAB))
    If jpAfter < jpBefore Then
        out.Close SaveChanges:=False
        GoTo Restore_And_Report_JP
    End If

    bad = FindErrorCells(out.Worksheets(DATA_TAB))
    If Len(bad) > 0 Then
        out.Close SaveChanges:=False
        Application.Calculation = prevCalc
        Application.DisplayAlerts = prevAlerts
        Application.EnableEvents = prevEvents
        Application.ScreenUpdating = prevScreen
        MsgBox "Not written — the copy has error cells in columns the app reads:" & vbLf & vbLf & _
               bad & vbLf & vbLf & _
               "Publishing these would put wrong numbers on the dashboard.", vbCritical, "Export Tradelog"
        Exit Sub
    End If

    rowsOut = LastDataRow(out.Worksheets(DATA_TAB))

    ' --- Replace, keeping one backup ------------------------------------------------------
    If Len(Dir(target)) > 0 Then
        If Len(Dir(backup)) > 0 Then Kill backup
        FileCopy target, backup
    End If
    out.SaveAs FileName:=target, FileFormat:=xlOpenXMLWorkbook, CreateBackup:=False
    out.Close SaveChanges:=False

    Application.Calculation = prevCalc
    Application.DisplayAlerts = prevAlerts
    Application.EnableEvents = prevEvents
    Application.ScreenUpdating = prevScreen

    MsgBox "Written: " & target & vbLf & vbLf & _
           "Tabs:            " & TAB_LIST & vbLf & _
           "Trade rows:      " & (rowsOut - 1) & vbLf & _
           "Yen-price rows:  " & jpAfter & " (formula preserved)" & vbLf & _
           "Error cells:     none" & vbLf & _
           "Backup:          Tradelog.backup.xlsx" & vbLf & vbLf & _
           "Next, in the repo folder:  npm run publish", vbInformation, "Export Tradelog"
    Exit Sub

Restore_And_Report_JP:
    Application.Calculation = prevCalc
    Application.DisplayAlerts = prevAlerts
    Application.EnableEvents = prevEvents
    Application.ScreenUpdating = prevScreen
    MsgBox "Not written. The copy kept only " & jpAfter & " of " & jpBefore & _
           " yen-price formulas." & vbLf & vbLf & _
           "Those rows price Japanese holdings off the US ADR, and the app recovers the real " & _
           "yen price from the formula text. Losing them would publish the ADR price instead " & _
           "— plausible-looking and wrong." & vbLf & vbLf & _
           "Usual cause: the Forex tab was not exported alongside Tradelog.", vbCritical, "Export Tradelog"
    Exit Sub

Failed:
    Dim msg As String
    msg = Err.Description
    On Error Resume Next
    If Not out Is Nothing Then out.Close SaveChanges:=False
    Application.Calculation = prevCalc
    Application.DisplayAlerts = prevAlerts
    Application.EnableEvents = prevEvents
    Application.ScreenUpdating = prevScreen
    On Error GoTo 0
    MsgBox "Export failed, nothing was replaced." & vbLf & vbLf & msg, vbCritical, "Export Tradelog"
End Sub

' --- Helpers ------------------------------------------------------------------------------

Private Function SheetExists(wb As Workbook, nm As String) As Boolean
    Dim ws As Object
    On Error Resume Next
    Set ws = wb.Sheets(nm)
    SheetExists = Not ws Is Nothing
    On Error GoTo 0
End Function

Private Function IsFileLocked(path As String) As Boolean
    Dim f As Integer
    If Len(Dir(path)) = 0 Then Exit Function
    f = FreeFile
    On Error Resume Next
    Open path For Binary Access Read Write Lock Read Write As #f
    IsFileLocked = (Err.Number <> 0)
    Close #f
    On Error GoTo 0
End Function

Private Function LastDataRow(ws As Worksheet) As Long
    LastDataRow = ws.Cells(ws.Rows.Count, "E").End(xlUp).Row   ' E = Symbol
End Function

' Rows whose raw-price cell is "<number>/rngUSD<CCY>" — the pattern extract-portfolio.js parses
' to recover a local-currency price. Counted in both the source and the copy so a silent loss
' stops the export rather than reaching the dashboard.
Private Function CountLocalPriceFormulas(ws As Worksheet) As Long
    Dim r As Long, last As Long, f As String, n As Long
    last = LastDataRow(ws)
    For r = 2 To last
        If ws.Cells(r, "F").HasFormula Then
            f = ws.Cells(r, "F").Formula
            If InStr(1, f, "rngUSD", vbTextCompare) > 0 Then
                ' Must still be a bare name. An external reference ("...xlsx'!rngUSDJPY") no
                ' longer matches the app's pattern, so it counts as lost.
                If InStr(f, "!") = 0 Then n = n + 1
            End If
        End If
    Next r
    CountLocalPriceFormulas = n
End Function

' Any Excel error sitting in a column the app parses as a number. The extractor throws on these
' rather than publishing NaN, so catching them here just moves the failure somewhere useful.
Private Function FindErrorCells(ws As Worksheet) As String
    Dim cols() As String, i As Long, r As Long, last As Long
    Dim hits As String, n As Long
    cols = Split(CHECK_COLS, ",")
    last = LastDataRow(ws)
    For i = LBound(cols) To UBound(cols)
        For r = 2 To last
            If IsError(ws.Cells(r, Trim$(cols(i))).Value) Then
                n = n + 1
                If n <= 8 Then
                    hits = hits & "  " & Trim$(cols(i)) & r & "  " & _
                           CStr(ws.Cells(r, Trim$(cols(i))).Text) & vbLf
                End If
            End If
        Next r
    Next i
    If n > 8 Then hits = hits & "  ...and " & (n - 8) & " more" & vbLf
    FindErrorCells = hits
End Function

' Drop query tables and workbook connections from the COPY only. Cached values are unaffected;
' what goes away is the copy's ability to refresh itself and overwrite them.
Private Sub RemoveConnections(wb As Workbook)
    Dim ws As Worksheet, qt As QueryTable, i As Long, lo As ListObject
    On Error Resume Next
    For Each ws In wb.Worksheets
        For Each qt In ws.QueryTables
            qt.Delete
        Next qt
        For Each lo In ws.ListObjects
            If Not lo.QueryTable Is Nothing Then lo.Unlink
        Next lo
    Next ws
    For i = wb.Connections.Count To 1 Step -1
        wb.Connections.Item(i).Delete
    Next i
    On Error GoTo 0
End Sub
