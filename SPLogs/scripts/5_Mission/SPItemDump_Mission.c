// ---------------- Params ----------------
static int   SP_START_DELAY_MS   = 60000;
static int   SP_REPEAT_EVERY_MS  = 60000;
static float SP_WORLD_STEP       = 1600.0;
static float SP_QUERY_RADIUS     = 1200.0;
static int   SP_BATCH_CELLS      = 3;
static int   SP_TICK_MS          = 100;

// delta
static float SP_MOVE_EPS         = 0.25;
static int   SP_HP_EPS_PCT       = 1;
static int   SP_LOG_REMOVALS     = 1;

// NOUVEAU: snapshots complets périodiques
static int   SP_FULL_SNAPSHOT_EVERY_N = 10; // Snapshot complet toutes les 10 frames

// ---------------- Time (UTC) ----------------
static void SP_UTC(out int y, out int m, out int d, out int h, out int mi, out int s)
{
	GetYearMonthDayUTC(y, m, d);
	GetHourMinuteSecondUTC(h, mi, s);
}
static string SP_Two(int v)
{
	string r;
	if (v < 10)
	{
		r = "0" + v.ToString();
	}
	else
	{
		r = v.ToString();
	}
	return r;
}
static string SP_TimestampISO_UTC()
{
	int y;
	int m;
	int d;
	int h;
	int mi;
	int s;
	SP_UTC(y,m,d,h,mi,s);
	return y.ToString()+"-"+SP_Two(m)+"-"+SP_Two(d)+"T"+SP_Two(h)+":"+SP_Two(mi)+":"+SP_Two(s);
}
static string SP_HourKeyUTC()
{
	int y;
	int m;
	int d;
	int h;
	int mi;
	int s;
	SP_UTC(y,m,d,h,mi,s);
	return y.ToString()+"-"+SP_Two(m)+"-"+SP_Two(d)+"_"+SP_Two(h);
}
static string SP_HourFileUTC()   { return "$profile:SPModding\\logs\\"+SP_HourKeyUTC()+".ljson"; }
static string SP_HourIndexFile() { return "$profile:SPModding\\state\\hour_"+SP_HourKeyUTC()+".spcache"; }

// ---------------- Utils ----------------
static float SP_WorldSizeFromName(string w)
{
	w.ToLower();
	if (w.Contains("chernarus")) return 15360.0;
	if (w.Contains("enoch") || w.Contains("livonia")) return 12800.0;
	if (w.Contains("deerisle")) return 20480.0;
	if (w.Contains("namalsk")) return 10240.0;
	return 15360.0;
}
static string SP_SafeText(string s)
{
	if (s == string.Empty) return s;
	s.Replace("\"","'");
	s.Replace("\n"," ");
	s.Replace("\r"," ");
	return s;
}
static string SP_GetDisplayNameSafe(EntityAI eai)
{
	string n = "";
	ItemBase ib = ItemBase.Cast(eai);
	if (ib)
	{
		n = ib.GetDisplayName();
		if (n != string.Empty) return SP_SafeText(n);
	}
	string path = "CfgVehicles " + eai.GetType() + " displayName";
	if (GetGame().ConfigIsExisting(path)) GetGame().ConfigGetText(path, n);
	if (n == string.Empty) n = eai.GetType();
	return SP_SafeText(n);
}
static void SP_EnsureDirs()
{
	string p0 = "$profile:SPModding";
	if (!FileExist(p0)) MakeDirectory(p0);
	string p1 = "$profile:SPModding\\logs";
	if (!FileExist(p1)) MakeDirectory(p1);
	string p2 = "$profile:SPModding\\state";
	if (!FileExist(p2)) MakeDirectory(p2);
}

// ---------------- IDs ----------------
static bool SP_GetPersistentCanon(EntityAI e, out string canon, out int pid1, out int pid2, out int pid3, out int pid4)
{
	canon = "";
	pid1 = 0;
	pid2 = 0;
	pid3 = 0;
	pid4 = 0;
	if (!e) return false;
	e.GetPersistentID(pid1, pid2, pid3, pid4);
	if (pid1 == 0 && pid2 == 0 && pid3 == 0 && pid4 == 0) return false;
	canon = "p:"+pid1.ToString()+":"+pid2.ToString()+":"+pid3.ToString()+":"+pid4.ToString();
	return true;
}

// ---------------- Holder / qty ----------------
static void SP_GetHolderInfo(ItemBase ib, out string holderClass, out string holderId)
{
	holderClass = "world";
	holderId = "";
	Man pl = ib.GetHierarchyRootPlayer();
	if (pl)
	{
		EntityAI pea = EntityAI.Cast(pl);
		if (pea)
		{
			string playerCanon;
			int pl1;
			int pl2;
			int pl3;
			int pl4;
			bool okPl = SP_GetPersistentCanon(pea, playerCanon, pl1, pl2, pl3, pl4);
			if (okPl)
			{
				holderClass = "player";
				holderId = playerCanon;
				return;
			}
		}
	}
	EntityAI parent = ib.GetHierarchyParent();
	if (parent)
	{
		string parentCanon;
		int pa1;
		int pa2;
		int pa3;
		int pa4;
		bool okPa = SP_GetPersistentCanon(parent, parentCanon, pa1, pa2, pa3, pa4);
		if (okPa)
		{
			holderClass = parent.GetType();
			holderId = parentCanon;
		}
	}
}
static int SP_GetQty(ItemBase ib)
{
	if (ib && ib.HasQuantity()) return Math.Round(ib.GetQuantity());
	return -1;
}

// ---------------- Cached state ----------------
class SPItemState
{
	vector PosV;
	int HpPct;
	string ClassName;
	int Qty;
	string HolderClass;
	string HolderId;
}

// ---------------- Scanner ----------------
class SPGridScanner
{
	private bool m_Running;
	private float m_WorldSize;
	private string m_WorldName;
	private string m_Timestamp;

	private string m_FilePath;
	private FileHandle m_File;

	private float m_Step;
	private float m_Radius;
	private int   m_BatchCells;
	private int   m_TickMs;

	private float m_X;
	private float m_Z;

	private ref map<string, int>             m_SeenThisFrame;
	private ref map<string, ref SPItemState> m_Last;

	private int m_TotalCells;
	private int m_DoneCells;
	private int m_Written;
	private int m_FrameCount;

	void SPGridScanner()
	{
		m_Running = false;
		m_Step = SP_WORLD_STEP;
		m_Radius = SP_QUERY_RADIUS;
		m_BatchCells = SP_BATCH_CELLS;
		m_TickMs = SP_TICK_MS;

		m_SeenThisFrame = new map<string, int>;
		m_Last = new map<string, ref SPItemState>;
		m_TotalCells = 0;
		m_DoneCells = 0;
		m_Written = 0;
		m_FrameCount = 0;
	}

	bool IsRunning(){ return m_Running; }

	// ---- index par heure: id|class|hp|qty|x|y|z|holderClass|holderId ----
	private void LoadHourIndex()
	{
		string path = SP_HourIndexFile();
		if (!FileExist(path)) return;
		FileHandle fh = OpenFile(path, FileMode.READ);
		if (!fh) return;
		string ln;
		while (FGets(fh, ln) > 0)
		{
			if (ln == "") continue;
			array<string> parts = new array<string>;
			ln.Split("|", parts);
			if (parts.Count() < 7) continue;
			string id  = parts.Get(0);
			string cls = parts.Get(1);
			int hp     = parts.Get(2).ToInt();
			int qty    = parts.Get(3).ToInt();
			float x    = parts.Get(4).ToFloat();
			float y    = parts.Get(5).ToFloat();
			float z    = parts.Get(6).ToFloat();
			string hcls = "world";
			string hid  = "";
			if (parts.Count() >= 8) hcls = parts.Get(7);
			if (parts.Count() >= 9) hid  = parts.Get(8);
			vector p = Vector(x,y,z);
			SPItemState st = m_Last.Get(id);
			if (!st)
			{
				st = new SPItemState();
				m_Last.Insert(id, st);
			}
			st.PosV = p;
			st.HpPct = hp;
			st.ClassName = cls;
			st.Qty = qty;
			st.HolderClass = hcls;
			st.HolderId = hid;
		}
		CloseFile(fh);
	}

	private void AppendHourIndex(string id, SPItemState st)
	{
		string path = SP_HourIndexFile();
		FileHandle fh = OpenFile(path, FileMode.APPEND);
		if (!fh) return;
		string ln = id+"|"+st.ClassName+"|"+st.HpPct.ToString()+"|"+st.Qty.ToString()+"|"+st.PosV[0].ToString()+"|"+st.PosV[1].ToString()+"|"+st.PosV[2].ToString()+"|"+st.HolderClass+"|"+st.HolderId;
		FPrintln(fh, ln);
		CloseFile(fh);
	}

	void Start()
	{
		if (m_Running) return;
		if (!GetGame().IsServer()) return;

		m_WorldName = GetGame().GetWorldName();
		if (m_WorldName == string.Empty) m_WorldName = "unknown";
		m_WorldSize = SP_WorldSizeFromName(m_WorldName);
		m_Timestamp = SP_TimestampISO_UTC();

		SP_EnsureDirs();

		m_FilePath = SP_HourFileUTC();
		m_File = OpenFile(m_FilePath, FileMode.APPEND);
		if (!m_File)
		{
			Print("[SPItemDump] Open failed: "+m_FilePath);
			return;
		}

		LoadHourIndex();

		m_X = 0.0;
		m_Z = 0.0;
		m_SeenThisFrame.Clear();
		m_Written = 0;

		int nx = Math.Ceil(m_WorldSize / m_Step) + 1;
		int nz = Math.Ceil(m_WorldSize / m_Step) + 1;
		m_TotalCells = nx * nz;

		m_Running = true;
		Print("[SPItemDump] Start frame " + m_Timestamp + " -> " + m_FilePath);

		GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(this.ProcessBatch, m_TickMs, true);
	}

	void Stop()
	{
		if (!m_Running) return;
		m_Running = false;
		GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).Remove(this.ProcessBatch);

		// Déterminer si c'est une frame de snapshot complet
		bool isSnapshotFrame = false;
		if (SP_FULL_SNAPSHOT_EVERY_N > 0)
		{
			int mod = m_FrameCount % SP_FULL_SNAPSHOT_EVERY_N;
			if (mod == 0)
			{
				isSnapshotFrame = true;
			}
		}

		if (isSnapshotFrame)
		{
			Print("[SPItemDump] Frame " + m_FrameCount.ToString() + " : SNAPSHOT COMPLET");
			// Écrire TOUS les items actuels avec un flag snapshot
			int snapshotIndex = 0;
			int snapshotCount = m_Last.Count();
			while (snapshotIndex < snapshotCount)
			{
				string snapshotId = m_Last.GetKey(snapshotIndex);
				SPItemState snapshotSt = m_Last.Get(snapshotId);
				if (snapshotSt)
				{
					// Écrire comme un item normal mais avec flag snapshot
					string line = "{";
					line = line + "\"type\":\"item\"";
					line = line + ",\"snapshot\":true";
					line = line + ",\"world\":\"" + m_WorldName + "\"";
					line = line + ",\"worldSize\":" + m_WorldSize.ToString();
					line = line + ",\"ts\":\"" + m_Timestamp + "\"";
					line = line + ",\"id\":\"" + snapshotId + "\"";
					line = line + ",\"class\":\"" + snapshotSt.ClassName + "\"";
					line = line + ",\"name\":\"" + snapshotSt.ClassName + "\"";
					float hp01 = snapshotSt.HpPct / 100.0;
					line = line + ",\"hp\":" + hp01.ToString();
					line = line + ",\"hp_percent\":" + snapshotSt.HpPct.ToString();
					line = line + ",\"qty\":" + snapshotSt.Qty.ToString();
					line = line + ",\"pos\":{\"x\":" + snapshotSt.PosV[0].ToString() + ",\"y\":" + snapshotSt.PosV[1].ToString() + ",\"z\":" + snapshotSt.PosV[2].ToString() + "}";
					line = line + ",\"holder_class\":\"" + snapshotSt.HolderClass + "\"";
					line = line + ",\"holder_id\":\"" + snapshotSt.HolderId + "\"";
					line = line + "}";
					if (m_File) FPrintln(m_File, line);
				}
				snapshotIndex = snapshotIndex + 1;
			}
		}

		// Log des suppressions (si activé)
		if (SP_LOG_REMOVALS == 1)
		{
			int removalIndex = 0;
			int removalCount = m_Last.Count();
			while (removalIndex < removalCount)
			{
				string removalId = m_Last.GetKey(removalIndex);
				if (!m_SeenThisFrame.Contains(removalId))
				{
					string rm = "{\"type\":\"item_remove\",\"world\":\""+m_WorldName+"\",\"worldSize\":"+m_WorldSize.ToString()+",\"ts\":\""+m_Timestamp+"\",\"id\":\""+removalId+"\"}";
					if (m_File) FPrintln(m_File, rm);
					m_Last.Remove(removalId);
					removalCount = m_Last.Count();
					removalIndex = removalIndex - 1;
				}
				removalIndex = removalIndex + 1;
			}
		}

		if (m_File) CloseFile(m_File);
		
		// Incrémenter le compteur de frames
		m_FrameCount = m_FrameCount + 1;
		
		Print("[SPItemDump] Frame "+m_Timestamp+" done. items_written="+m_Written.ToString()+" frame_count="+m_FrameCount.ToString());
	}

	private bool HasChanged(ref SPItemState prev, vector p, int hpPct, string cls, int qty, string holderClass, string holderId)
	{
		if (!prev) return true;
		float dist = vector.Distance(prev.PosV, p);
		if (dist >= SP_MOVE_EPS) return true;
		int dhp = hpPct - prev.HpPct;
		if (dhp < 0) dhp = -dhp;
		if (dhp >= SP_HP_EPS_PCT) return true;
		if (prev.ClassName != cls) return true;
		if (prev.Qty != qty) return true;
		if (prev.HolderClass != holderClass) return true;
		if (prev.HolderId != holderId) return true;
		return false;
	}

	private void UpdateCache(string id, vector p, int hpPct, string cls, int qty, string holderClass, string holderId)
	{
		SPItemState st = m_Last.Get(id);
		if (!st)
		{
			st = new SPItemState();
			m_Last.Insert(id, st);
		}
		st.PosV = p;
		st.HpPct = hpPct;
		st.ClassName = cls;
		st.Qty = qty;
		st.HolderClass = holderClass;
		st.HolderId = holderId;
		AppendHourIndex(id, st);
	}

	private void EmitItemLine(string id, string cls, string name, vector p, float hp01, int hpPct, int qty, string holderClass, string holderId)
	{
		string sig = cls + "|" + hpPct.ToString() + "|" + qty.ToString();

		string line = "{";
		line = line + "\"type\":\"item\"";
		line = line + ",\"world\":\"" + m_WorldName + "\"";
		line = line + ",\"worldSize\":" + m_WorldSize.ToString();
		line = line + ",\"ts\":\"" + m_Timestamp + "\"";
		line = line + ",\"id\":\"" + id + "\"";
		line = line + ",\"class\":\"" + cls + "\"";
		line = line + ",\"name\":\"" + SP_SafeText(name) + "\"";
		line = line + ",\"hp\":" + hp01.ToString();
		line = line + ",\"hp_percent\":" + hpPct.ToString();
		line = line + ",\"qty\":" + qty.ToString();
		line = line + ",\"pos\":{\"x\":" + p[0].ToString() + ",\"y\":" + p[1].ToString() + ",\"z\":" + p[2].ToString() + "}";
		line = line + ",\"holder_class\":\"" + holderClass + "\"";
		line = line + ",\"holder_id\":\"" + holderId + "\"";
		line = line + ",\"sig\":\"" + sig + "\"";
		line = line + "}";

		if (m_File) FPrintln(m_File, line);
		m_Written = m_Written + 1;
	}

	private void ProcessBatch()
	{
		if (!m_Running) return;

		int processed = 0;
		while (processed < m_BatchCells && m_Running)
		{
			ProcessOneCell();
			processed = processed + 1;
		}
		if (m_X > m_WorldSize && m_Z > m_WorldSize) Stop();
	}

	private void ProcessOneCell()
	{
		if (m_Z > m_WorldSize)
		{
			m_X = m_X + m_Step;
			m_Z = 0.0;
		}
		if (m_X > m_WorldSize)
		{
			return;
		}

		vector pos = Vector(m_X, 0, m_Z);
		array<Object> objects = new array<Object>;
		GetGame().GetObjectsAtPosition3D(pos, m_Radius, objects, NULL);

		int objIndex = 0;
		while (objIndex < objects.Count())
		{
			Object o = objects.Get(objIndex);
			if (o)
			{
				EntityAI e = EntityAI.Cast(o);
				ItemBase ib = ItemBase.Cast(o);
				if (e && ib)
				{
					string canon;
					int ip1;
					int ip2;
					int ip3;
					int ip4;
					bool okId = SP_GetPersistentCanon(e, canon, ip1, ip2, ip3, ip4);
					if (!okId)
					{
						objIndex = objIndex + 1;
						continue;
					}

					if (m_SeenThisFrame.Contains(canon))
					{
						objIndex = objIndex + 1;
						continue;
					}
					m_SeenThisFrame.Insert(canon, 1);

					vector p = ib.GetPosition();
					float hp01 = ib.GetHealth01("", "");
					if (hp01 < 0.0) hp01 = 0.0;
					if (hp01 > 1.0) hp01 = 1.0;
					int hpPct = Math.Round(hp01 * 100.0);
					string cls = ib.GetType();
					string name = SP_GetDisplayNameSafe(ib);
					int qty = SP_GetQty(ib);
					string holderClass;
					string holderId;
					SP_GetHolderInfo(ib, holderClass, holderId);

					SPItemState prev = m_Last.Get(canon);
					bool changed = HasChanged(prev, p, hpPct, cls, qty, holderClass, holderId);

					bool shouldWrite = false;
					if (!prev)
					{
						shouldWrite = true;
					}
					else if (changed)
					{
						shouldWrite = true;
					}

					if (shouldWrite)
					{
						EmitItemLine(canon, cls, name, p, hp01, hpPct, qty, holderClass, holderId);
						UpdateCache(canon, p, hpPct, cls, qty, holderClass, holderId);
					}
				}
			}
			objIndex = objIndex + 1;
		}

		m_DoneCells = m_DoneCells + 1;
		m_Z = m_Z + m_Step;
	}
}

// ---------------- scheduler ----------------
static ref SPGridScanner g_SPScanner;
static void SP_StartDumpSafe()
{
	if (!g_SPScanner) g_SPScanner = new SPGridScanner();
	if (!g_SPScanner.IsRunning()) g_SPScanner.Start();
}
static void SP_TryStartPeriodic()
{
	if (!g_SPScanner) g_SPScanner = new SPGridScanner();
	if (!g_SPScanner.IsRunning()) g_SPScanner.Start();
}
modded class MissionServer
{
	override void OnMissionStart()
	{
		super.OnMissionStart();
		GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(SP_StartDumpSafe, SP_START_DELAY_MS, false);
		GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(SP_TryStartPeriodic, SP_REPEAT_EVERY_MS, true);
	}
}