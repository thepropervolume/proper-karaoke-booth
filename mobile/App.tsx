import React, { useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { addPreviewRequest, initialPreview, searchPreview, withdrawPreviewRequest } from './src/preview';

/** An offline native layout preview. No invitation or network code is connected. */
export default function App() {
  const [state, setState] = useState(initialPreview);
  const [query, setQuery] = useState('');
  const songs = useMemo(() => searchPreview(state, query), [state, query]);
  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.brand}>THE PROPER VOLUME</Text>
      <Text style={styles.title}>Singer preview</Text>
      <Text style={styles.notice}>Offline demo with sample songs. Nothing is sent to a host or saved.</Text>
      <Text style={styles.heading}>Your requests</Text>
      {state.requests.length === 0 && <Text style={styles.muted}>No demo requests yet.</Text>}
      {state.requests.map(request => {
        const song = state.songs.find(item => item.id === request.versionId);
        return <View key={request.id} style={styles.card}>
          <View style={styles.grow}><Text style={styles.song}>{song?.title ?? 'Sample song'}</Text><Text style={styles.muted}>{request.status}</Text></View>
          {request.status === 'accepted' && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Withdraw demo request for ${song?.title ?? 'song'}`} style={styles.secondary} onPress={() => setState(current => withdrawPreviewRequest(current, request.id))}><Text style={styles.buttonText}>Withdraw</Text></TouchableOpacity>}
        </View>;
      })}
      <Text style={styles.heading}>Song library</Text>
      <TextInput accessibilityLabel="Search sample songs" placeholder="Search sample songs" placeholderTextColor="#a9a5b4" value={query} onChangeText={setQuery} style={styles.input} />
      {!songs.length && <Text style={styles.muted}>No sample songs match.</Text>}
      {songs.map(song => <View key={song.id} style={styles.card}>
        <View style={styles.grow}><Text style={styles.song}>{song.title}</Text><Text style={styles.muted}>{song.artist}</Text></View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Request demo song ${song.title}`} style={styles.button} onPress={() => setState(current => addPreviewRequest(current, song.id))}><Text style={styles.buttonText}>Request</Text></TouchableOpacity>
      </View>)}
      <Text style={styles.footer}>Live invitations and real requests are not connected in this preview.</Text>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#14111c' }, content: { padding: 20, paddingBottom: 40 },
  brand: { color: '#dfaeef', letterSpacing: 2, fontWeight: '700', fontSize: 12 }, title: { color: '#fff', fontSize: 30, fontWeight: '800', marginTop: 8 },
  notice: { color: '#f7dca7', marginTop: 10, lineHeight: 21 }, heading: { color: '#fff', fontSize: 21, fontWeight: '700', marginTop: 28, marginBottom: 12 },
  input: { color: '#fff', backgroundColor: '#292433', borderColor: '#70657f', borderWidth: 1, borderRadius: 9, padding: 12, marginBottom: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#272231', borderRadius: 10, padding: 14, marginBottom: 8 },
  grow: { flex: 1 }, song: { color: '#fff', fontWeight: '700', fontSize: 16 }, muted: { color: '#cbc2d4', marginTop: 3 },
  button: { backgroundColor: '#8356a0', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 }, secondary: { backgroundColor: '#51455d', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  buttonText: { color: '#fff', fontWeight: '700' }, footer: { color: '#cbc2d4', marginTop: 24, lineHeight: 20 },
});
