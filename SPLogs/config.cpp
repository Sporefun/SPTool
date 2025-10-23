class CfgPatches
{
	class SPLogs
	{
		requiredVersion = 0.1;
		requiredAddons[] = 
		{
			"DZ_Data","DZ_Scripts"
		};
	};
};

class CfgMods
{
	class SPLogs
	{
		dir = "SPLogs";
		picture = "";
		action = "";
		hideName = 1;
		hidePicture = 1;
		name = "SPLogs";
		credits = "Sporefun";
		author = "sporefun";
		version = "0.1";
		extra = 0;
		type = "mod";
	    dependencies[]={"Game","World","Mission"};

		class defs
		{
			class missionScriptModule
			{
				value="";
				files[]={"SPLogs/scripts/5_Mission"};
			};
		};
	};
};