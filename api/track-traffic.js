import fetch from 'node-fetch';

// Safely clean the Notion ID and aggressively strip out any accidental quotes
function cleanNotionId(input) {
  if (!input) return null;
  // This physically deletes any " or ' marks you might have accidentally pasted in Vercel
  let clean = input.replace(/['"]/g, '').trim(); 
  
  if (clean.includes('?')) clean = clean.split('?')[0]; 
  if (clean.includes('/')) {
    const parts = clean.split('/');
    clean = parts[parts.length - 1]; 
  }
  return clean.replace(/-/g, '');
}

export default async function handler(req, res) {
  const logs = [];
  const today = new Date().toISOString().split('T')[0];

  const rawNotionId = process.env.NOTION_DATABASE_ID;
  const notionToken = process.env.NOTION_TOKEN?.replace(/['"]/g, '').trim();
  const githubToken = process.env.GITHUB_PAT?.replace(/['"]/g, '').trim();
  const username = process.env.GITHUB_USERNAME?.replace(/['"]/g, '').trim();

  if (!username || !githubToken || !notionToken || !rawNotionId) {
    return res.status(400).json({ 
      success: false, 
      error: "Missing one or more Environment Variables in Vercel." 
    });
  }

  const databaseId = cleanNotionId(rawNotionId);

  try {
    const commonHeaders = {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Vercel-Automated-Traffic-App'
    };

    const reposResponse = await fetch(`https://api.github.com/user/repos?type=owner&per_page=100`, { headers: commonHeaders });

    if (!reposResponse.ok) {
      throw new Error(`GitHub Auth Failed. Check if your PAT is correct.`);
    }

    const allRepos = await reposResponse.json();
    const repoNames = allRepos.map(repo => repo.name);

    if (repoNames.length === 0) {
      return res.status(200).json({ success: true, details: [] });
    }

    for (const repo of repoNames) {
      try {
        const trafficResponse = await fetch(`https://api.github.com/repos/${username}/${repo}/traffic/views`, { headers: commonHeaders });

        if (!trafficResponse.ok) {
          logs.push({ repo: repo, status: "error", message: "GitHub blocked traffic access." });
          continue; 
        }

        const trafficData = await trafficResponse.json();
        const totalViews = trafficData.count || 0;
        const uniqueVisitors = trafficData.uniques || 0;

        const notionResponse = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
          },
          body: JSON.stringify({
            parent: { database_id: databaseId },
            properties: {
              "Name": { title: [{ text: { content: today } }] },
              "Repository": { rich_text: [{ text: { content: repo } }] },
              "Total Views": { number: totalViews },
              "Unique Visitors": { number: uniqueVisitors }
            }
          })
        });

        if (!notionResponse.ok) {
          const notionError = await notionResponse.json();
          logs.push({ repo: repo, status: "error", message: `Notion Error: ${notionError.message}` });
        } else {
          logs.push({ repo: repo, status: "success", message: `Logged ${totalViews} views, ${uniqueVisitors} unique.` });
        }

      } catch (repoError) {
        logs.push({ repo: repo, status: "error", message: `Crashed: ${repoError.message}` });
      }
    }

    return res.status(200).json({ success: true, details: logs });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
